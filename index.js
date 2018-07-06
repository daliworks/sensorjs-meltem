'use strict';

var logger = require('log4js').getLogger('Sensor');

function initDrivers() {
  var meltemCVSSensor;
  var meltemCVSActuator;

  try {
    meltemCVSSensor = require('./driver/meltemCVSSensor');
  } catch(e) {
    logger.error('Cannot load ./driver/meltemCVSSensor', e);
  }

  try {
    meltemCVSActuator = require('./driver/meltemCVSActuator');
  } catch(e) {
    logger.error('Cannot load ./driver/meltemCVSActuator', e);
  }

  return {
    meltemCVSSensor: meltemCVSSensor,
    meltemCVSActuator: meltemCVSActuator
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
    meltemCVSSensor: ['meltemCVSMode', 'meltemCVSRPM', 'meltemCVSCurrent', 'meltemCVSPressure', 'meltemCVSPower', 'meltemCVSTemperature', 'meltemCVSOperatingTime'],
    meltemCVSActuator: ['meltemCVSSettings']
  },
  initNetworks: initNetworks,
  initDrivers: initDrivers
};
