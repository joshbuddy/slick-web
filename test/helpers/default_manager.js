var crypto = require('crypto');
var execSync = require('child_process').execSync;
var EventEmitter = require('events').EventEmitter;
var emitter = new EventEmitter();

module.exports = () => {
  before(() => {
    execSync('rm -rf /tmp/slick-test');
  })

  beforeEach(function(done) {
    this.rootPath = '/tmp/slick-test/' + crypto.randomBytes(12).toString('hex');
    var manager = this.manager = new Manager(this.rootPath);
    manager.configure((setup, doneSetup) => {
      setup.meta.useMemory();
      setup.bulk.useMemory();
      doneSetup();
    }).requestPassword(() => {
      assert(false, 'requested password')
    }).on('fatal', (error) => {
      assert(false, 'got a fatal error ' + error);
    }).on('warning', (warning) => {
      console.error('got a warning', warning);
    }).whenReady(() => {
      done();
    });
    manager.start();
  })

}

process.on('exit', () => {
  execSync('rm -rf /tmp/slick-test');
})