'use strict';

var util = require('util');
var SensorLib = require('../index');
var Sensor = SensorLib.Sensor;
var logger = Sensor.getLogger('Sensor');
var meltem = require('../meltem');

function MeltemCVSSensor(sensorInfo, options) {
  var self = this;

  Sensor.call(self, sensorInfo, options);

  self.sequence = self.id.split('-')[2];
  self.deviceAddress = self.id.split('-')[1];
  self.gatewayId = self.id.split('-')[0];
  self.lastTime = 0;
  self.lastValue = 0;
  self.dataArray = [];
  self.realtimeNotification = true;

  if (sensorInfo.model) {
    self.model = sensorInfo.model;
  }

  self.dataType = MeltemCVSSensor.properties.dataTypes[self.model][0];

  self.master = meltem.create(self.gatewayId);

  try {
    self.device = self.master.addDevice(self.deviceAddress);

    self.master.on(self.deviceAddress + '-' + self.sequence, function onData(data) {
      var result = {
        status: 'on',
        id: self.id,
        result: {},
        time: {}
      };

      logger.trace(self.id, ':', data);

      if ((self.sequence === 'pressure') && (data.value === 0)) {
        result.result[self.dataType] = self.lastValue;
      }
      else {
        result.result[self.dataType] = self.lastValue = data.value;
      }
      result.time[self.dataType] = self.lastTime = data.time;

      if (self.realtimeNotification) {
        self.emit('change', result);
      }
      else {
        self.dataArray.push(result);
      }
    });
    logger.trace(self.id, ': installed');
  }
  catch(err)  {
    logger.debug(self.id, ': Exception occurred -', err);
  }
}

MeltemCVSSensor.properties = {
  supportedNetworks: ['meltem-cvs'],
  dataTypes: {
    meltemCVSMode: ['state'],
    meltemCVSRPM: ['rpm'],
    meltemCVSCurrent: ['current'],
    meltemCVSPower: ['electricPower'],
    meltemCVSPressure: ['pressure'],
    meltemCVSTemperature: ['temperature'],
    meltemCVSOperatingTime: ['number']
  },
  models: [
    'meltemCVSMode',
    'meltemCVSRPM',
    'meltemCVSCurrent',
    'meltemCVSPower',
    'meltemCVSPressure',
    'meltemCVSOperatingTime',
    'meltemCVSTemperature'
  ],
  discoverable: false,
  addressable: true,
  maxInstances: 99,
  maxRetries: 8,
  idTemplate: '{gatewayId}-{deviceAddress}-{sequence}',
  onChange: {
    'meltemCVSMode': false,
    'meltemCVSRPM' : true,
    'meltemCVSCurrent' : true,
    'meltemCVSPower' : true,
    'meltemCVSPressure' : true,
    'meltemCVSOperatingTime' : true,
    'meltemCVSTemperature' : true
  },
  category: 'sensor'
};

util.inherits(MeltemCVSSensor, Sensor);

MeltemCVSSensor.prototype._get = function (cb) {
  var self = this;
  var result = {
    status: 'off',
    id: self.id,
    result: {},
    time: {}
  };

  var elapsedTime = new Date().getTime() - self.lastTime;

  if (elapsedTime <= self.device.getConnectionTimeout()){
    logger.trace(self.id, 'The last data transmission time interval - [', elapsedTime, 'ms ]') ;
    result.status = 'on';
    result.result[self.dataType] = self.lastValue;
    result.time[self.dataType] = self.lastTime;
    self.dataArray = [];
  }
  else {
    logger.info(self.id, 'The device did not respond.') ;
  }

  return  cb && cb(null, result);
};

MeltemCVSSensor.prototype._enableChange = function () {
};

MeltemCVSSensor.prototype._clear = function () {
};

module.exports = MeltemCVSSensor;
