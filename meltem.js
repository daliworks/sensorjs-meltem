'use strict';

var util = require('util');
var SerialPort = require('serialport');
var _ = require('lodash');
var EventEmitter = require('events').EventEmitter;

var logger = require('./index').Sensor.getLogger('Sensor');

var serialOpts = {
  baudRate: 115200,
  parity: 'none',
  parser: SerialPort.parsers.readline('0D0A')
};

var SERIAL_PORT_FILE = '/dev/ttyS0';
var RETRY_OPEN_INTERVAL = 3000; // 3sec

function parseMessage(data) {
  var result = {};
  var dataArray = new Buffer(data).toString().split(';');
  var error;

  if (dataArray.length > 6) {
    error = new Error('Too many items: ' + dataArray.length);
  } else if (dataArray.length < 6) {
    error = new Error('Missing item. The number of item: ' + dataArray.length);
  } else if (dataArray[0].length > 6) {
    error = new Error('Too long receiver node ID: ' + dataArray[0].length);
  } else if (dataArray[1].length > 6) {
    error = new Error('Too long sender node ID: ' + dataArray[1].length);
  } else if (dataArray[2].length > 3) {
    error = new Error('Too long sensor ID: ' + dataArray[2].length);
  } else if (dataArray[3].length > 1) {
    error = new Error('Too long sensor type: ' + dataArray[3].length);
  } else if (dataArray[0].length === 0) {
    error = new Error('No receiver node ID');
  } else if (dataArray[1].length === 0) {
    error = new Error('No sender node ID');
  } else if (dataArray[2].length === 0) {
    error = new Error('No sensor ID');
  } else if (dataArray[3].length === 0) {
    error = new Error('No sensor type');
  } else if (dataArray[4].length === 0) {
    error = new Error('No value');
  }

  result.receiverNodeId = dataArray[0];
  result.senderNodeId = dataArray[1];
  result.sensorId = dataArray[2];
  result.sensorType = dataArray[3];
  result.value = parseFloat(dataArray[4]);

  logger.trace('Parsed:', result);

  return error || result;
}

function openSerialPort(vcek, errorCb) {
  var self;

  if (_.isFunction(vcek)) {
    self = module.exports;
    errorCb = vcek;
  } else {
    self = vcek;
  }

  self.port = new SerialPort(SERIAL_PORT_FILE, serialOpts, function onOpen(err) {
    logger.info('[Vcek] Connected');

    if (err) {
      logger.error('Serial port error during opening:', err);

      return errorCb && errorCb(err);     // Call error callback only when error during opening
    } else {
      logger.info('[Vcek] No err, Connected');
    }

    self.port.on('error', function onError(err) {
      logger.error('Serial port error:', err);

      return;
    });

    self.port.on('close', function onClose(err) {
      if (err) {
        logger.error('Serial port error during closing:', err);
        // TODO: if error, isn't this closed?
      } else {
        logger.info('Serial port is closed');
      }

      return;
    });

    self.port.on('disconnect', function onDisconnect(err) {
      logger.error('Serial port is disconnected:', err);

      return;
    });

    self.port.on('data', function onData(data) {
      var parsedData;

      logger.trace('[Vcek] onData():', new Buffer(data).toString());

      parsedData = parseMessage(data);

      if (parsedData instanceof Error) {
        logger.error(parsedData);
        return;
      }

      self.emit(parsedData.sensorType, parsedData);
    });
  });
}

function openSerialErrorCallback(/*err*/) {
  setTimeout(function () {
    openSerialPort(openSerialErrorCallback);
  }, RETRY_OPEN_INTERVAL);
}

// TODO: If opening port takes long time, async function cannot be finished.
function Vcek () {
  var self = this;

  EventEmitter.call(self);

  openSerialPort(self, openSerialErrorCallback);
}

util.inherits(Vcek, EventEmitter);

Vcek.prototype.close = function () {
  logger.info('Closing serial port');
  this.port.close();
};

module.exports = new Vcek();
