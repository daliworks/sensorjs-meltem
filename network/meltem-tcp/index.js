'use strict';

var sensorDriver = require('../../index'),
    Network = sensorDriver.Network,
    util = require('util');

// 1. Rename the network name 'MeltemNetwork'
function MeltemNetwork(options) {
  Network.call(this, 'meltem-cvs-tcp', options);
}

util.inherits(MeltemNetwork, Network);

MeltemNetwork.prototype.discover = function (networkName, options, cb) {
  return cb && cb(new Error('Not supported'));
};

module.exports = new MeltemNetwork();
