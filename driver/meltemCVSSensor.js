'use strict';

var util = require('util');
var SensorLib = require('../index');
var Sensor = SensorLib.Sensor;
var logger = Sensor.getLogger('Sensor');
var meltem = require('../meltem');

function meltemCVSSensor(sensorInfo, options) {
  var self = this;

  Sensor.call(self, sensorInfo, options);

  self.sequence = self.id.split('-')[2];
  self.deviceAddress = self.id.split('-')[1];
  self.gatewayId = self.id.split('-')[0];
  self.lastTime = 0;
  self.dataArray = [];

  if (sensorInfo.model) {
    self.model = sensorInfo.model;
  }

  self.dataType = meltemCVSSensor.properties.dataTypes[self.model][0];
  self.isNotification = true;

  self.master = meltem.create();

  try {
    self.master.addDevice(self.deviceAddress);

    self.master.on(self.deviceAddress + '-' + self.sequence, function onData(data) {
      var result = {
        status: 'on',
        id: self.id,
        result: {},
        time: {}
      };

      logger.trace('Data : ', data);

      result.result[self.dataType] = self.lastValue = data.value;
      result.time[self.dataType] = self.lastTime = new Date().getTime();

      if (self.isNotification) {
        self.emit('data', result);
      }
      else{
        self.dataArray.push(result);
      }
    });
  }
  catch(err)  {
    logger.debug('[Meltem CVS] Exception occurred :', err);
  }
}

meltemCVSSensor.properties = {
  supportedNetworks: ['meltem-cvs'],
  dataTypes: {
    meltemCVSMode: ['state'],
    meltemCVSRPM: ['rpm'],
    meltemCVSCurrent: ['current'],
    meltemCVSPressure: ['pressure'],
    meltemCVSTemperature: ['temperature']
  },
  models: [
    'meltemCVSMode',
    'meltemCVSRPM',
    'meltemCVSCurrent',
    'meltemCVSPressure',
    'meltemCVSTemperature'
  ],
  discoverable: false,
  addressable: true,
  recommendedInterval: 60000,
  maxInstances: 99,
  maxRetries: 8,
  idTemplate: '{gatewayId}-{deviceAddress}-{sequence}',
  category: 'sensor'
};

util.inherits(MeltemSensor, Sensor);

meltemCVSSensor.prototype._get = function (cb) {
  var self = this;
  var result = {
    status: 'on',
    id: self.id,
    result: {},
    time: {}
  };

  //if (self.isNotification && self.master)
  //{
    //self.master.sendMessage(self.id.split('-')[1], 'D00');
  //}
  //else
  {
    if (new Date().getTime() - self.lastTime > self.properties.recommendedInterval * 1.5) {
      result.status = 'error';
      result.message = 'No data';
      if (cb) {
        return cb(new Error('no data'), result);
      } else {
        self.emit('data', result);
        return;
      }
    }

    if (self.dataArray.length) {
      result.result[self.dataType] = self.lastValue;
      result.time[self.dataType] = self.lastTime;
      self.dataArray = [];
    }
    else {
      result.time[self.dataType] = self.lastTime;
    }
  }

  logger.debug('Data get:', self.id, result);

  if (cb) {
    return cb(null, result);
  } else {
    self.emit('data', result);
  }
};

meltemCVSSensor.prototype._enableChange = function () {
};

meltemCVSSensor.prototype._clear = function () {
};

module.exports = meltemCVSSensor;
