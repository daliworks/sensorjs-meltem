'use strict';

var util = require('util');

var SensorLib = require('../index');
var Sensor = SensorLib.Sensor;
var logger = Sensor.getLogger('Sensor');
var meltem = require('../meltem');

function MeltemSensor(sensorInfo, options) {
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

  self.dataType = MeltemSensor.properties.dataTypes[self.model][0];
  self.isNotification = true;

  self.driver = meltem.get(self.deviceAddress);
  if (self.driver == undefined)
  {
    self.driver = meltem.create(self.deviceAddress);
  }

  try {
    self.driver.on(self.sequence, function onData(data) {
      var result = {
        status: 'on',
        id: self.id,
        result: {},
        time: {}
      };

      logger.trace('Data : ', data);

      result.result[self.dataType] = self.lastValue = data.value;
      result.time[self.dataType] = self.lastTime = new Date().getTime();

      self.dataArray.push(result);
     // self.emit('data', result);
    });
  }
  catch(err)  {
    logger.debug('[Meltem CVS] Exception occurred :', error);
  }
}

MeltemSensor.properties = {
  supportedNetworks: ['meltem-cvs'],
  dataTypes: {
    meltemCVSMode: ['string'],
    meltemCVSRPM: ['speed'],
    meltemCVSCurrent: ['current'],
    meltemCVSPressure: ['pressure']
  },
  models: [
    'meltemCVSMode',
    'meltemCVSRPM',
    'meltemCVSCurrent',
    'meltemCVSPressure'
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

MeltemSensor.prototype._get = function (cb) {
  var self = this;
  var result = {
    status: 'on',
    id: self.id,
    result: {},
    time: {}
  };

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

  if (self.dataArray.length != 0)
  {
    result.result[self.dataType] = self.lastValue;
    result.time[self.dataType] = self.lastTime;
    self.dataArray = [];
  }
  else
  {
    result.time[self.dataType] = self.lastTime;
  }

  logger.debug('Data get:', self.id, result);

  if (cb) {
    return cb(null, result);
  } else {
    self.emit('data', result);
  }
};

MeltemSensor.prototype._enableChange = function () {
};

MeltemSensor.prototype._clear = function () {
};

module.exports = MeltemSensor;
