'use strict';

var util = require('util');
var SensorLib = require('../index');
var Actuator = SensorLib.Actuator;
var logger = Actuator.getLogger();
var meltem = require('../meltem');

function MeltemCVSActuator(sensorInfo, options) {
  var self = this;

  Actuator.call(self, sensorInfo, options);

  self.sequence = self.id.split('-')[2];
  self.deviceAddress = self.id.split('-')[1];
  self.gatewayId = self.id.split('-')[0];
  self.lastTime = 0;
  self.myStatus = 'on';

  if (sensorInfo.model) {
    self.model = sensorInfo.model;
  }

  self.dataType = MeltemCVSActuator.properties.dataTypes[self.model][0];
  
  self.master = meltem.create(self.gatewayId);

  try {
    self.device = self.master.addDevice(self.deviceAddress);
    if (!self.device) {
      throw 'Cant create device : ' + self.deviceAddress;
    }
  }
  catch(err)  {
    logger.debug('[Meltem CVS] Exception occurred :', err);
  }
}

MeltemCVSActuator.properties = {
  supportedNetworks: ['meltem-cvs-tcp'],
  dataTypes: {
    meltemCVSSettings: ['stringActuator']
  },
  models: [
    'meltemCVSSettings'
  ],
  commands: {
    meltemCVSSettings: [ 'send' ]
  },
  discoverable: false,
  addressable: true,
  recommendedInterval: 60000,
  maxInstances: 99,
  maxRetries: 8,
  idTemplate: '{gatewayId}-{deviceAddress}-{sequence}',
  category: 'actuator'
};

util.inherits(MeltemCVSActuator, Actuator);

MeltemCVSActuator.prototype._get = function (cb) {
  var self = this;
  var result = {
    status: 'on',
    id: self.id
  };

  return  cb && cb(null, result);
};

MeltemCVSActuator.prototype._set = function (cmd, options, cb) {
  var self = this;

  try{
    if (options.text) {
      var settings = JSON.parse(options.text);

      if (self.device) {
        self.device.emit('control', settings, cb);
      }
      else {
        return  cb('Not supported control!');
      }
    }
  }
  catch(err) {
    return cb && cb(err);
  }
};

MeltemCVSActuator.prototype.getStatus = function () {
  var self = this;

  return self.myStatus;
};

MeltemCVSActuator.prototype.connectListener = function () {
  var self = this;

  self.myStatus = 'on';
};

MeltemCVSActuator.prototype.disconnectListener = function () {
  var self = this;

  var rtn = {
    status: 'off',
    id: self.id,
    message: 'disconnected'
  };

  self.myStatus = 'off';
  self.emit('data', rtn);
};

module.exports = MeltemCVSActuator;
