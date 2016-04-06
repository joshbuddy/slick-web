var express = require('express');
var path = require('path');
var fs = require('fs');
var _ = require('lodash');
var mime = require('mime');
var bodyParser = require('body-parser');
var EventEmitter = require('events').EventEmitter;
var url = require('url');
var urlParse = url.parse;
var urlFormat = url.format;

var Server = module.exports = function(manager, config) {
  this.manager = manager;
  this.config = config;

  var server = this;
  var app = this.app = express();
  var application = manager.volumes;
  var router = module.exports = express.Router();

  app.set('views', __dirname + '/views');
  app.use(express.static(__dirname + '/public'));
  router.use(function(req, res, next) {
    res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:"+server.port+'/');
    return next();
  });
  router.use(bodyParser.urlencoded({ extended: true }));
  router.use(bodyParser.json());

  var volumeAsJson = function(name, volume) {
    return {name: name, url: '/api/volumes/'+name+'/entries', size: volume.root.size};
  }

  var entryAsJson = function(fullpath, url, entry) {
    var name = path.basename(fullpath);
    return {digest: entry.digest && entry.digest.toString('hex'), ctime: entry.ctime, mtime: entry.mtime, name: name, folder: entry.objectType === 'fo', type: entry.type, size: entry.size, url: url, fullpath: fullpath};
  }

  // operations
  router.get('/operations', function(req, res) {
    var operations = [];
    manager.operations.each(function(operation, id, next) {
      operations.push({id: id, state: operation.state, volume: operation.volume, destination: operation.destination, sources: operation.sources, type: 'add', mode: operation.mode})
      next();
    }, function(err) {
      if (err) return res.status(500).end('fatal error');
      res.send({operations: operations});
    });
  })

  router.post('/operations', function(req, res) {
    var body = req.body;
    switch (body.type) {
      case 'mkdir':
        var target = body.target;
        if (!target.name) return res.status(400).end('target must have name');
        if (!target.path) return res.status(400).end('target must have path');
        application.volume(target.name).mkdir(target.path, function(err) {
          if (err && err.isInvalidData) return res.status(400).end(err.message);
          if (err) return res.status(500);
          res.status(204).end('directory created');
        })
        break;
      case 'copy':
        var source = body.source;
        var destination = body.destination;
        if (!source.name) return res.status(400).end('source must have name');
        if (!source.path) return res.status(400).end('source must have path');
        if (!destination.name) return res.status(400).end('destination must have name');
        if (!destination.path) return res.status(400).end('destination must have path');
        var force = body.force;
        application.volume(source.name).copy(source.path, destination.name, destination.path, {force: force}, function(err) {
          if (err && err.isInvalidData) return res.status(400).end(err.message);
          if (err) return res.status(500);
          res.status(204).end('copied');
        })
        break;
      case 'move':
        var source = body.source;
        var destination = body.destination;
        if (!source.name) return res.status(400).end('source must have name');
        if (!source.path) return res.status(400).end('source must have path');
        if (!destination.name) return res.status(400).end('destination must have name');
        if (!destination.path) return res.status(400).end('destination must have path');
        var force = body.force;
        application.volume(source.name).move(source.path, destination.name, destination.path, {force: force}, function(err) {
          if (err && err.isInvalidData) return res.status(400).end(err.message);
          if (err) return res.status(500);
          res.status(204).end('copied');
        })
        break;
      case 'add':
        var destination = body.destination;
        var sources = body.sources;
        var conflict = body.conflict || 'skip';

        if (!destination.name) return res.status(400).end('destination must have name');
        if (!destination.path) return res.status(400).end('destination must have path');
        if (!Array.isArray(sources)) return res.status(400).end('sources must be an array');
        if (['skip', 'replace', 'rename'].indexOf(conflict) === -1) return res.status(400).end('unknown conflict mode '+conflict);

        application.volume(destination.name).getVolume(function(err, volume) {
          if (err && err.isNotFound) return res.status(400).end('cannot find volume');
          if (err) return res.status(500).end('fatal error')
          application.volume(destination.name).add(destination.path, sources, {conflict: conflict}, function(err, id) {

            if (err) return res.status(500).end('fatal error');
            res.redirect(303, '/api/operations/'+id);
          });
        })
        break;
      default:
        return res.status(400).end('source is not of type slick or local');
    }
  })

  router.delete('/operations/:id', function(req, res) {
    var id = parseInt(req.params.id);

    manager.operations.cancel(id, function(err, succeeded) {
      if (err && err.isInvalidData) return res.status(400).end(err.message);
      if (err) return res.status(500).end('fatal error');
      res.status(204).end('operation canceled');
    });
  })

  router.get('/operations/:id', function(req, res) {
    var id = parseInt(req.params.id);

    manager.operations.get(id, function(err, job) {
      if (err) return res.status(500).end('fatal error');
      if (!job) return res.status(404).end('not found');

      var eventUrl = `/api/operations/${id}/events`;
      res.send({operation: {state: job.state, events: eventUrl}});
    })

  })

  var getOperationStream = function(req, res) {
    req.socket.setTimeout(0); // disable timeout
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('\n');

    var eventId = 0;
    var emit = function(body) {
      res.write('id: ' + eventId++ + '\n');
      res.write('data:' + JSON.stringify(body) + '\n\n'); // Note the extra newline
    }

    var id = parseInt(req.params.id);
    var listener = manager.operations.listen(id);
    listener
      .once('completed', function() { emit({operationId: id, state: 'completed'}) })
      .once('error', function(err) { emit({operationId: id, state: 'error', message: String(err)}) })
      .on('progress', function(state) {
        emit({operationId: id, state: 'progress', total: state.total, current: state.current})
      });

    manager.operations.get(id, function(err, job) {
      if (err) return res.status(500).end('fatal error');
      if (!job) return res.status(404).end('not found');

      emit({operationId: id, state: job.state});
    });
  }

  router.get('/operations/events', getOperationStream)
  router.get('/operations/:id/events', getOperationStream);

  // volumes
  router.get('/volumes', function(req, res) {
    console.error('getting volumes')
    var volumes = [];
    console.error('eaching vols')
    application.eachVolume(function(volume, next) {
      volume.getVolume(function(err, volumeInstance) {
        if (err) return res.status(500).end('fatal error');
        volumes.push(volumeAsJson(volume.name, volumeInstance));
        next();
      })
    }, function(err) {
      console.error('done', err, volumes)
      if (err) return res.status(500).end('fatal error');
      res.send({volumes: volumes});
    });
  })

  router.post('/volumes', function(req, res) {
    if (!req.body.name) return res.status(400).end('name not defined');

    var name = req.body.name;
    application.volume(name).create(function(err) {
      if (err && err.isInvalidData) return res.status(400).end(err.message);
      if (err) return res.status(500).end('fatal error');
      res.status(201).send({});
    });
  });

  router.get('/volumes/:name', function(req, res) {
    var volumeName = req.params.name;
    application.volume(volumeName).getVolume(function(err, volume) {
      if (err && err.isNotFound) return res.status(404).end('not found')
      if (err) return res.status(500).end('fatal error');
      res.send({volume: volumeAsJson(volumeName, volume)});
    })
  })

  router.delete('/volumes/:name', function(req, res) {
    var volumeName = req.params.name;
    application.volume(volumeName).destroy(function(err) {
      if (err && err.isNotFound) return res.status(404).end('not found')
      if (err && err.isInvalidData) return res.status(400).end(err.message);
      if (err) return res.status(500).end('fatal error');
      res.status(204).end('volume '+volumeName+' deleted');
    })
  })

  // entries
  router.delete('/volumes/:name/entries/*', function(req, res) {
    var volumeName = req.params.name;
    var volumePath = '/' + (req.params[0] || '');
    application.volume(volumeName).remove(volumePath, function(err) {
      if (err && err.isInvalidData) return res.status(400).end(err.message);
      if (err) return res.status(500).end('fatal error');
      res.status(201).send({});
    });
  });

  var getEntries = function(req, res) {
    var volumeName = req.params.name;
    var volumePath = '/' + (req.params[0] || '');
    var entries = [];

    application.volume(volumeName).list(volumePath, function(fullpath, entry, next) {
      var parsedUrl = urlParse(req.originalUrl);
      parsedUrl.pathname = path.join('/api/volumes', volumeName, 'entries', fullpath)
      entries.push(entryAsJson(fullpath, urlFormat(parsedUrl), entry));
      next();
    }, function(err) {
      if (err && err.isNotFound) return res.status(404).end('not found');
      if (err && err.isInvalidData) return res.status(400).end(err.message);
      if (err) return res.status(500).end('fatal error');
      res.send({entries: entries});
    });
  }

  router.get('/volumes/:name/entries', getEntries)
  router.get('/volumes/:name/entries/*', getEntries)

  // file data
  var headFile = function(req, res) {
    var volumeName = req.params.name;
    var volumePath = '/' + (req.params[0] || '');
    application.volume(volumeName).get(volumePath, function(err, entry) {
      if (err && err.isNotFound) return res.status(404).end(err.message);
      if (err) return res.status(500).end('fatal error');
      if (!entry) return res.status(404).end('not found');

      var commonHeaders = {
        'X-Created-time': entry.ctime,
        'X-Modified-time': entry.mtime,
        'X-Slick-base64': entry.lastReference ? entry.lastReference.toBuffer().toString('base64') : entry.toBuffer().toString('base64'),
        'Content-length': entry.size.toString(),
        'Content-type': entry.type || 'x-slick/folder'
      }

      switch(entry.objectType) {
        case 'fo':
          res.writeHead(200, _.merge(commonHeaders, {
            'X-Slick-type': 'folder',
            'X-Slick-folder-count': entry.entries.count.toString()
          }));
          res.end();
          break;
        case 'fl':
          res.writeHead(200, _.merge(commonHeaders, {
            'Accept-Ranges': 'bytes',
            'X-Slick-type': 'file'
          }));
          res.end();
          break;
        default:
          console.error("unknown type", entry);
          res.status(500).end();
      }
    })
  }

  router.head('/volumes/:name/file', headFile)
  router.head('/volumes/:name/file/*', headFile)

  router.get('/volumes/:name/file/*', function(req, res) {
    var volumeName = req.params.name;
    var volumePath = '/' + (req.params[0] || '');
    application.volume(volumeName).get(volumePath, function(err, file) {
      if (err) return res.status(500).end('fatal error');
      if (!file) return res.status(404).end('not found');
      if (file.objectType === 'fo') return res.status(400).end('invalid target')

      if (req.headers.range) {
        var range = req.headers.range;
        var positions = range.replace(/bytes=/, "").split("-");
        var start = parseInt(positions[0], 10);
        // range is inclusive
        var end = positions[1] ? parseInt(positions[1], 10) : file.size - 1;
        var chunksize = (end - start) + 1;

        if (start >= end) return res.status(400).end('start is greater than end');
        if (end > file.size) return res.status(400).end('end exceeds file length');

        res.writeHead(206, {
          "Content-Range": "bytes " + start + "-" + end + "/" + file.size,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize,
          "Content-Type": file.type
        });

        // range is inclusive, rangeSteam is exclusive
        file.rangeStream(start, end + 1).pipe(res);
      } else {
        res.setHeader('Content-type', file.type);
        res.setHeader('Content-length', file.size);
        file.eachBuffer(function(buf, next) {
          res.write(buf);
          next();
        }, function(err) {
          res.end();
        })
      }
    })
  })

  router.all('*', function(req, res) {
    res.status(404).end('not found')
  })

  app.use('/api', router);
}

Server.prototype.run = function(cb) {
  var port = this.config.port;
  var server = this;
  server.port = port;
  server.app.listen(port);
  console.log("API listening on localhost "+port)
  cb();
}

