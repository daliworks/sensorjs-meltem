'use strict';

var logger = require('log4js').getLogger('Sensor');

function initDrivers() {
  var meltemSensor;

  try {
    meltemSensor = require('./driver/meltemSensor');
  } catch(e) {
    logger.error('Cannot load ./driver/meltemSensor', e);
  }

  return {
    meltemSensor: meltemSensor
  };
}

function initNetworks() {
  var network;

  try {
    network = require('./network/meltem');
  } catch (e) {
    logger.error('Cannot load ./network/meltem', e);
  }

  return {
    'meltem': network
  };
}

module.exports = {
  networks: ['meltem-cvs'],
  drivers: {
    meltemSensor: ['meltemCVSMode', 'meltemCVSRPM', 'meltemCVSCurrent', 'meltemCVSPressure']
  },
  initNetworks: initNetworks,
  initDrivers: initDrivers
};
