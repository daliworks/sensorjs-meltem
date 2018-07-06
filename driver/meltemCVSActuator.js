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
  
  if (sensorInfo.model) {
    self.model = sensorInfo.model;
  }

  self.dataType = MeltemCVSActuator.properties.dataTypes[self.model][0];
  
  self.master = meltem.create();

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
  return this.myStatus;
};

MeltemCVSActuator.prototype.connectListener = function () {
  this.myStatus = 'on';
};

MeltemCVSActuator.prototype.disconnectListener = function () {
  var rtn = {
    status: 'off',
    id: this.id,
    message: 'disconnected'
  };

  this.myStatus = 'off';
  this.emit('data', rtn);
};

module.exports = MeltemCVSActuator;
