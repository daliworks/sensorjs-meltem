'use strict';

var sensorDriver = require('../../index'),
    Network = sensorDriver.Network,
    util = require('util');

// 1. Rename the network name 'RS232MELTEM'
function RS232MELTEM(options) {
  Network.call(this, 'rs232-meltem', options);
}

util.inherits(RS232MELTEM, Network);

RS232MELTEM.prototype.discover = function (networkName, options, cb) {
  return cb && cb(new Error('Not supported'));
};

module.exports = new RS232MELTEM();
