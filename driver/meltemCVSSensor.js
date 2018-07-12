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
  self.lastData = { value: 0, time: 0};
  self.dataArray = [];

  if (sensorInfo.model) {
    self.model = sensorInfo.model;
  }

  self.dataType = MeltemCVSSensor.properties.dataTypes[self.model][0];
  self.onChange =  MeltemCVSSensor.properties.onChange[self.model];
  self.master = meltem.create(self.gatewayId);

  try {
    self.device = self.master.addDevice(self.deviceAddress);

    self.master.on(self.deviceAddress + '-' + self.sequence, function onData(data) {

      logger.trace(self.id, ':', data);

      if ((self.sequence !== 'pressure') || (data.value !== 0)) {
        self.lastData.value = data.value;
      }
      self.lastData.time = data.time;

      if (self.onChange) {
        var result = {
          status: 'on',
          id: self.id,
          result: {},
          time: {}
        };

        result.result[self.dataType] = self.lastData.value;
        result.time[self.dataType] = self.lastData.time;

        self.emit('change', result);
      }
      else {
        self.dataArray.push(self.lastData);
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
    'meltemCVSMode': true,
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

MeltemCVSSensor.prototype._get = function () {
  var self = this;
  var result = {
    status: 'off',
    id: self.id,
    result: {},
    time: {}
  };

  if (self.onChange) {
    var elapsedTime = new Date().getTime() - self.lastData.time;
  
    if (elapsedTime <= self.device.getConnectionTimeout()){
      logger.trace(self.id, 'The last data transmission time interval - [', elapsedTime, 'ms ]') ;
      result.status = 'on';
      result.result[self.dataType] = self.lastData.value;
      result.time[self.dataType] = self.lastData.time;
    }
  }
  else{
    if (self.dataArray.length){
      result.status = 'on';
      result.result[self.dataType] = self.lastData.value;
      result.time[self.dataType] = self.lastData.time;
      self.dataArray = [];
    }

    self.emit('data', result); 
  }

  if (result.status === 'off') {
    logger.info(self.id, 'The device did not respond.') ;
  }
};

MeltemCVSSensor.prototype._enableChange = function () {
};

MeltemCVSSensor.prototype._clear = function () {
};

module.exports = MeltemCVSSensor;
