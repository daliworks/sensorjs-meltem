'use strict';

var util = require('util');

var SensorLib = require('../index');
var Actuator = SensorLib.Actuator;
var _ = require('lodash');
var logger = Actuator.getLogger();
var meltem = require('../meltem');

function MeltemActuator(sensorInfo, options) {
  var self = this;

  Actuator.call(self, sensorInfo, options);

  self.sequence = self.id.split('-')[2];
  self.deviceAddress = self.id.split('-')[1];
  self.gatewayId = self.id.split('-')[0];
  self.lastTime = 0;
  
  if (sensorInfo.model) {
    self.model = sensorInfo.model;
  }

  self.dataType = MeltemActuator.properties.dataTypes[self.model][0];
  
  self.master = meltem.create(9000);

  try {
    var device;

    device = self.master.addDevice(self.deviceAddress);
    if (device == undefined ) {
      throw 'Cant create device : ' + self.deviceAddress;
    }

    self.master.on(self.deviceAddress + '-' + self.sequence, function onData(settings) {
      device.emit('settings', settings);
    });
  }
  catch(err)  {
    logger.debug('[Meltem CVS] Exception occurred :', err);
  }
}

MeltemActuator.properties = {
  supportedNetworks: ['meltem-cvs-tcp'],
  dataTypes: {
    meltemCVSSettings: ['string']
  },
  models: [
    'meltemCVSSettings'
  ],
  commands: {
    meltemCVSSettings: [ 'set', 'get' ]
  },
  discoverable: false,
  addressable: true,
  recommendedInterval: 60000,
  maxInstances: 99,
  maxRetries: 8,
  idTemplate: '{gatewayId}-{deviceAddress}-{sequence}',
  category: 'actuator'
};

util.inherits(MeltemActuator, Actuator);

function sendCommand(actuator, cmd, options, cb) {
  if (_.isFunction(options)) {
    cb = options;
    options = null;
  }

  logger.trace('sendCommand : ', actuator.deviceAddress, actuator.sequence, cmd, options);
 
  try {
    var settings = JSON.parse(options.settings);
    logger.trace('Settings : ', settings);

    cb(undefined, 'Success!');
  }
  catch(err) {
    cb('Invalid JSON format', err);
  }
}

MeltemActuator.prototype._set = function (cmd, options, cb) {
  var self = this;

  try{
    if (options.settings != undefined) {
      var settings = JSON.parse(options.settings);
      self.master.emit(self.deviceAddress + '-' + self.sequence, settings);
    }
  }
  catch(err) {
    return cb && cb(err);
  }

}

MeltemActuator.prototype._get = function (cmd, options, cb) {
  var self = this;
  
  sendCommand(self.shortId, cmd, options, function (err, result) {
    if(err) {
      self.myStatus = 'err';
    } else {
      self.myStatus = 'on';
    }
    return cb && cb(err, result);
  });
};

MeltemActuator.prototype.getStatus = function () {
  return this.myStatus;
};

MeltemActuator.prototype.connectListener = function () {
  this.myStatus = 'on';
};

MeltemActuator.prototype.disconnectListener = function () {
  var rtn = {
    status: 'off',
    id: this.id,
    message: 'disconnected'
  };

  this.myStatus = 'off';
  this.emit('data', rtn);
};

module.exports = MeltemActuator;
