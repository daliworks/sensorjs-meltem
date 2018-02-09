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
  var rs232Vcek;

  try {
    rs232Vcek = require('./network/rs232-meltem');
  } catch (e) {
    logger.error('Cannot load ./network/rs232-meltem', e);
  }

  return {
    'rs232-meltem': rs232Vcek
  };
}

module.exports = {
  networks: ['rs232-meltem'],
  drivers: {
    meltemSensor: ['meltemTemperature', 'meltemHumidity', 'meltemNoise', 'meltemDust', 'meltemLight', 'meltemWeight']
  },
  initNetworks: initNetworks,
  initDrivers: initDrivers
};
