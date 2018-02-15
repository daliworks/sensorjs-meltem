'use strict';

var logger = require('log4js').getLogger('Sensor');

function initDrivers() {
  var meltemSensor;
  var meltemActuator;

  try {
    meltemSensor = require('./driver/meltemSensor');
  } catch(e) {
    logger.error('Cannot load ./driver/meltemSensor', e);
  }

  try {
    meltemActuator = require('./driver/meltemActuator');
  } catch(e) {
    logger.error('Cannot load ./driver/meltemActuator', e);
  }

  return {
    meltemCVSSensor: meltemSensor,
    meltemCVSActuator: meltemActuator
  };
}

function initNetworks() {
  var network;

  try {
    network = require('./network/meltem-tcp');
  } catch (e) {
    logger.error('Cannot load ./network/meltem-tcp', e);
  }

  return {
    'meltem': network
  };
}

module.exports = {
  networks: ['meltem-cvs-tcp'],
  drivers: {
    meltemCVSSensor: ['meltemCVSMode', 'meltemCVSRPM', 'meltemCVSCurrent', 'meltemCVSPressure', 'meltemCVSPower', 'meltemCVSTemperature'],
    meltemCVSActuator: ['meltemCVSSettings']
  },
  initNetworks: initNetworks,
  initDrivers: initDrivers
};
