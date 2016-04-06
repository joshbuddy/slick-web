var request = require('supertest')
var Web = require('../..');
var path = require('path');

describe('Rest API', function() {
  defaultManager();

  beforeEach(function() {
    this.volumes = this.manager.volumes;
    var web = new Web(this.manager, {});
    this.app = web.app;
  })

  beforeEach(function(done) {
    this.volumes.volume('test').create(function(err) {
      assert(!err);
      done();
    })
  })

  describe('get volumes', function() {
    it('should respond with json', function(done) {
      var app = this.app;
      request(app)
        .get('/api/volumes')
        .expect('Content-Type', /json/)
        .expect(200, { volumes: [{name: 'test', size: 0, url: '/api/volumes/test/entries'}] }, done);
    })
  })

  describe('create a volume', function() {
    it('should respond with a 201', function(done) {
      var app = this.app;
      var volumes = this.volumes;
      request(app)
        .post('/api/volumes')
        .send({name: 'newvol'})
        .expect(201, function() {
          volumes.volume('newvol').getVolume(function(err, volume) {
            assert(!err);
            assert(volume);
            done()
          })
        });
    })
  })

  describe('delete a volume', function() {
    it('should respond with a 202', function(done) {
      var app = this.app;
      var volumes = this.volumes;
      request(app)
        .delete('/api/volumes/test')
        .expect(202, function() {
          volumes.volume('test').getVolume(function(err, volume) {
            assert(err.isNotFound);
            assert(!volume);
            done()
          })
        });
    })
  })

  describe('get a volume', function() {
    it('should respond with json', function(done) {
      var app = this.app;
      request(app)
        .get('/api/volumes/test')
        .expect('Content-Type', /json/)
        .expect(200, { volume: {name: 'test', size: 0, url: '/api/volumes/test/entries'} }, done);
    })

    it('should respond with a 404 for a non-existent volume', function(done) {
      var app = this.app;
      request(app)
        .get('/api/volumes/blah')
        .expect(404, done);
    })
  })

  describe('with files', function() {
    beforeEach(function(done) {
      var source = path.resolve(__dirname + '/../fixtures/*');
      var operations = this.manager.operations;
      this.volumes.volume('test').add('/', [source], function(err, id) {
        assert(!err);
        operations.listen(id).on('completed', done);
      })
    })

    it('should get a folder on a volume', function(done) {
      var app = this.app;
      var expectedEntries = [
        {
          "name": "[3].png",
          "folder": false,
          "size": 39752,
          "type": "image/png",
          "url": "/api/volumes/test/entries/[3].png"
        },
        {
          "name": "another-file",
          "folder": false,
          "size": 9,
          "type": "application/octet-stream",
          "url": "/api/volumes/test/entries/another-file"
        },
        {
          "name": "dumb",
          "folder": true,
          "size": 36,
          "url": "/api/volumes/test/entries/dumb"
        },
        {
          "name": "test-copy",
          "folder": false,
          "size": 34,
          "type": "application/octet-stream",
          "url": "/api/volumes/test/entries/test-copy"
        },
        {
          "name": "test-copy2",
          "folder": false,
          "size": 8,
          "type": "application/octet-stream",
          "url": "/api/volumes/test/entries/test-copy2"
        }
      ]

      request(app)
        .get('/api/volumes/test/entries')
        .expect(function(res) {
          assert.equal(res.body.entries.length, 5);
          var entries = _.map(res.body.entries, function(map) {return _.pick(map, ['name', 'folder', 'size', 'type', 'url'])})
          assert.deepEqual(entries, expectedEntries);
        })
        .expect(200, done);
    })

    it('should get a file on a volume', function(done) {
      var app = this.app;
      var body = fs.readFileSync(path.resolve(__dirname + '/../fixtures/test-copy'));

      request(app)
        .get('/api/volumes/test/file/test-copy')
        .expect('Content-Type', 'application/octet-stream')
        .expect('Content-Length', '34')
        .expect(function(res) {
          assert.equal(res.text, body.toString())
        })
        .expect(200, done);
    })

    it('should return a 404 for a non-existent entry', function(done) {
      var app = this.app;
      request(app)
        .get('/api/volumes/test/entries/some-other-thing')
        .expect(404, done);
    })
  })

  describe('with operations', function() {
    describe('adding', function() {
      it('should stream events on adding', function(done) {
        var manager = this.manager;
        var volumes = this.volumes;
        var app = this.app;
        var source = path.resolve(__dirname + '/../fixtures/*');

        request(app)
          .post('/api/operations')
          .send({sources: [source], destination: {name: 'test', path: '/test-copy'}, type: 'add'})
          .expect('location', /\/api\/operations\/.*/)
          .expect(303, function(_, response) {
            var id = parseInt(response.headers.location.split('/')[3]);
            manager.operations.listen(id).once('completed', done);
            manager.operations.listen(id).once('error', function(err) {
              assert(!err);
              assert(false);
            });
          });
      })

      // lots of 400 errors i can get here
    })

    describe('copying', function() {
      beforeEach(function(done) {
        var volumes = this.volumes;
        var source = path.resolve(__dirname + '/../fixtures/*');
        var volume = volumes.volume('test2');
        var operations = this.manager.operations;
        volume.create(function(err) {
          assert(!err);
          volume.add('/', [source], function(err, id) {
            assert(!err);
            operations.listen(id).once('completed', done);
          });
        })
      })

      it('should stream event on adding', function(done) {
        var volumes = this.volumes;
        var app = this.app;

        request(app)
          .post('/api/operations')
          .send({source: {name: 'test2', path: '/test-copy'}, destination: {name: 'test', path: '/test-copy'}, type: 'copy'})
          .expect(204, done);
      })
    })
  })
})
