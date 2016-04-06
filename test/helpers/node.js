execSync = require('child_process').execSync;
fs = require('fs');
assert = require('chai').assert;
_ = require("lodash");
Manager = require('slick-io');
Server = require('./server');
defaultManager = require('./default_manager');
