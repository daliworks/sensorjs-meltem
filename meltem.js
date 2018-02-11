'use strict';

var util = require('util');
var SerialPort = require('serialport');
var net = require('net');
var _ = require('lodash');
var EventEmitter = require('events').EventEmitter;
var array = [];

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
  var frame = new Buffer(data).toString().replace(/[\n\r]+/g,'');
  var dataArray = frame.split(' ');
  var error;
  

  var T1 = {};
  var T2 = {};
  var T3 = {};
  var S3 = {};

  try {
    if (dataArray.length != 9) {
      throw 'Invalid frame : ' + frame;
    }

    if ((dataArray[5].length < 10) || (dataArray[6].length < 10) || (dataArray[7].length < 10) || (dataArray[8].length < 10)) {
      throw 'Invalid field size'; 
    }


    result.mode = dataArray[0];
    result.pressure = parseInt(dataArray[1].substr(0, 4));
    if (result.pressure == NaN) {
      throw 'Invalid field[1] : ' + dataArray[1]; 
    }

    result.targetFanRPM = parseInt(dataArray[2].substr(0, 4));
    if (result.targetFanRPM == NaN) {
      throw 'Invalid field[2] : ' + dataArray[2]; 
    }

    result.currentFanRPM = parseInt(dataArray[3].substr(0, 4));
    if (result.currentFanRPM == NaN) {
      throw 'Invalid field[3] : ' + dataArray[3]; 
    }

    result.current = parseInt(dataArray[4].substr(0, 4));
    if (result.current == NaN) {
      throw 'Invalid field[4] : ' + dataArray[4]; 
    }

    T1.rpm = parseInt(dataArray[5].substr(0, 4));
    if (T1.rpm == NaN) {
      throw 'Invalid field[5] : ' + dataArray[5]; 
    }

    T1.current = parseInt(dataArray[5].substr(5, 4));
    if (T1.current == NaN) {
      throw 'Invalid field[5] : ' + dataArray[5]; 
    }

    result.T1 = T1;

    T2.rpm = parseInt(dataArray[6].substr(0, 4));
    if (T2.rpm == NaN) {
      throw 'Invalid field[6] : ' + dataArray[6]; 
    }

    T2.current = parseInt(dataArray[6].substr(5, 4));
    if (T2.current == NaN) {
      throw 'Invalid field[6] : ' + dataArray[6]; 
    }

    result.T2 = T2;

    T3.rpm = parseInt(dataArray[7].substr(0, 4));
    if (T3.rpm == NaN) {
      throw 'Invalid field[7] : ' + dataArray[7]; 
    }

    T3.current = parseInt(dataArray[7].substr(5, 4));
    if (T3.current == NaN) {
      throw 'Invalid field[7] : ' + dataArray[7]; 
    }

    result.T3 = T3;

    S3.rpm = parseInt(dataArray[8].substr(0, 4));
    if (S3.rpm == NaN) {
      throw 'Invalid field[8] : ' + dataArray[8]; 
    }

    S3.current = parseInt(dataArray[8].substr(5, 4));
    if (S3.current == NaN) {
      throw 'Invalid field[8] : ' + dataArray[8]; 
    }

    result.S3 = S3;

    logger.trace('Parsed:', result);
  }
  catch (err) {
    error = new Error(err);
  }

  return error || result;
}

function getValue(sequence, result) {
  var value = {};

  value.sequence = String(sequence);
  switch(sequence) {
    case  1: value.value = result.mode; break;
    case  2: value.value = result.pressure; break;
    case  3: value.value = result.targetFanRPM; break;
    case  4: value.value = result.currentFanRPM; break;
    case  5: value.value = result.current; break;
    case  6: value.value = result.T1.rpm; break;
    case  7: value.value = result.T1.current; break;
    case  8: value.value = result.T2.rpm; break;
    case  9: value.value = result.T2.current; break;
    case  10: value.value = result.T3.rpm; break;
    case  11: value.value = result.T3.current; break;
    case  12: value.value = result.S3.rpm; break;
    case  13: value.value = result.S3.current; break;
  }

  return  value;
}
function openNetPort(cvs, errorCb) {
  var self;

  if (_.isFunction(cvs)) {
    self = module.exports;
    errorCb = cvs;
  } else {
    self = cvs;
  }

  self.server = net.createServer(function(client){ 
    logger.info('[Meltem CVS] Client connected.');

    client.on('data', function(data){ 
      var parsedData;

      logger.trace('[Meltem CVS] onData():', new Buffer(data).toString());

      parsedData = parseMessage(data);

      if (parsedData instanceof Error) {
        logger.error(parsedData);
        return;
      }

      var i;
      for(i = 0 ; i < 13 ; i++)
      {
          var value = getValue(i + 1, parsedData);
        self.emit(i+1, value);
      }
    }); 
    
    client.on('end', function(){ 
      logger.info('[Meltem CVS] Client disconnected'); 
    }); 
    
    client.write('Hello'); 
  }); 
  
  self.server.listen(self.port, function()
  { 
    logger.info('[Meltem CVS] Server listening for connection'); 
  });
}

function openNetErrorCallback(/*err*/) {
  setTimeout(function () {
    openNetPort(openNetErrorCallback);
  }, RETRY_OPEN_INTERVAL);
}

function openSerialPort(cvs, errorCb) {
  var self;

  if (_.isFunction(cvs)) {
    self = module.exports;
    errorCb = cvs;
  } else {
    self = cvs;
  }

  self.port = new SerialPort(SERIAL_PORT_FILE, serialOpts, function onOpen(err) {
    logger.info('[Meltem CVS] Connected');

    if (err) {
      logger.error('Serial port error during opening:', err);

      return errorCb && errorCb(err);     // Call error callback only when error during opening
    } else {
      logger.info('[Meltem CVS] No err, Connected');
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

      logger.trace('[Meltem CVS] onData():', new Buffer(data).toString());

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
function MeltemCVS (port) {
  var self = this;

  self.port = port;
  EventEmitter.call(self);

  logger.info('[Meltem CVS] port : ', self.port);
  openNetPort(self, openNetErrorCallback);
}

util.inherits(MeltemCVS, EventEmitter);

MeltemCVS.prototype.close = function () {
  logger.info('Closing port');
  this.port.close();
};

function Create(port) {
  var i;

  for(i = 0 ; i < array.length ; i++)
  {
      if (array[i].port == port)
      {
          return  array[i];
      }
  }

  logger.info('[Meltem CVS] Create new instance : ', port);

  var newCVS = new MeltemCVS(port);

  array.push(newCVS);

  return  newCVS;
}

function  Get(port) {
  var i;

  for(i = 0 ; i < array.length ; i++)
  {
      if (array[i].port == port)
      {
          return  array[i];
      }
  }

  return undefined;
}

module.exports = {
  create: Create,
  get:  Get
};