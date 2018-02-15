'use strict';

var util = require('util');
var SerialPort = require('serialport');
var net = require('net');
var _ = require('lodash');
var EventEmitter = require('events').EventEmitter;
var Device = require('./meltemDevice');
var masters = [];

var logger = require('./index').Sensor.getLogger('Sensor');

var serialOpts = {
  baudRate: 115200,
  parity: 'none',
  parser: SerialPort.parsers.readline('0D0A')
};

var SERIAL_PORT_FILE = '/dev/ttyS0';
var RETRY_OPEN_INTERVAL = 3000; // 3sec

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
function MeltemCVSMaster (port) {
  var self = this;

  self.port = port;
  self.id = '999';
  self.clients = [];
  self.devices = [];
  self.minimumInterval = 60000;
  self.minimumRequestInterval = 1000;
  self.responseWaitingTime = 5000;
  self.requestDate = 0;

  EventEmitter.call(self);

  logger.info('[Meltem CVS] port : ', self.port);
  self.open(openNetErrorCallback);
}

util.inherits(MeltemCVSMaster, EventEmitter);

MeltemCVSMaster.prototype.open = function(errorCb) {
  var self = this;

  self.server = net.createServer(function (client) {
    var master;

    master = self;

    logger.info('[Meltem CVS] Client connected.');

    master.clients.push(client);

    client.index = 0;
    client.parent = master;
    client.startDate = new Date();
    client.timeout   = client.startDate.getTime();
    client.loopInterval = client.parent.minimumInterval;

    client.on('data', function (data) {
      self = this;
      
      self.parent.devices.map(function(device){
        device.emit('data', data);
      });
    });

    client.on('end', function () {
      self = this;

      clearInterval(client.nextUpdateTimeout);
      var i;
      for (i = 0; i < self.parent.clients.length; i++) {
        if (self.parent.clients[i] == client) {
          self.parent.clients.splice(i, 1);
          break;
        }
      }
      logger.info('[Meltem CVS] Client disconnected');
    });

    client.on('update', function(){
        self = this;
        var totalTime = 0;

        self.updateStartTime = new Date;

        self.parent.devices.map(function(device) {
          var occupationTime;
          // Device occupancy time.
          occupationTime = device.getOccupationTime(self.parent.responseWaitingTime);
          device.emit('update', totalTime, occupationTime - 10);
          // The start time of the next device.
          totalTime += occupationTime;
        });

        if (totalTime < self.parent.minimumInterval) {
          totalTime = self.parent.minimumInterval;
        }

        self.loopInterval = totalTime;

        self.parent.nextUpdateTimeout = setTimeout(function(){
          self.emit('update');
        }, self.loopInterval);
    });

    client.emit('update');
  });

  self.server.listen(self.port, function () {
    logger.info('[Meltem CVS] Server listening for connection');
  });
}

function openNetErrorCallback(/*err*/) {
  setTimeout(function () {
    //openNetPort(openNetErrorCallback);
  }, RETRY_OPEN_INTERVAL);
}

MeltemCVSMaster.prototype.close = function () {
  logger.info('Closing port');
  this.port.close();
};

MeltemCVSMaster.prototype.addDevice = function(id) {
  var self = this;
  var i;
  var device = {};

  for(i = 0 ; i < self.devices.length ; i++) {
    if (self.devices[i].id == id) {
      return self.devices[i];
    }
  }

  device = Device.create(self, id);
  
  logger.trace('Add Device : ', device);
  self.devices.push(device);

  return  device;
}

MeltemCVSMaster.prototype.getDevice = function(id) {
  var self = this;
  var i;

  for(i = 0 ; i < self.devices.length ; i++) {
    if (self.devices[i].id == id) {
      return self.devices[i];
    }
  }

  return undefined;
}

MeltemCVSMaster.prototype.sendMessage = function (id, message) {
  var   self = this;
  var   i;
  var   date = new Date;
  var   timeGap = date.getTime() - self.requestDate;

  if (timeGap >= self.minimumRequestInterval) {
      timeGap = 0;
  }

  setTimeout(function () {
    for (i = 0; i < self.clients.length; i++) {
      logger.trace('Send Message : <' + id + self.id + message + '>');
      self.clients[i].write('<' + id + self.id + message + '>\r\n');
    }
  }, self.minimumRequestInterval - timeGap);
}

function CreateMaster(port) {
  var i;
  var basePort = parseInt(port) / 100 * 100;

  for(i = 0 ; i < masters.length ; i++)
  {
      if (masters[i].port == basePort)
      {
          return  masters[i];
      }
  }

  logger.info('[Meltem CVS] Create new instance : ', basePort);

  var newMaster = new MeltemCVSMaster(basePort);

  masters.push(newMaster);

  return  newMaster;
}

function DestroyMaster(port) {
  var i;
  var basePort;

  basePort = parseInt(port) / 100 * 100;

  for(i = 0 ; i < masters.length ; i++)
  {
      if (masters[i].port == basePort)
      {
          masters.splice(i, 1);
          return ;
      }
  }
}

function  GetMaster(port) {
  var i;
  var basePort;

  basePort  = parseInt(port) / 100 * 100;

  for(i = 0 ; i < masters.length ; i++)
  {
      if (masters[i].port == basePort)
      {
          return  masters[i];
      }
  }

  return undefined;
}

module.exports = {
  create: CreateMaster,
  destroy: DestroyMaster,
  get:  GetMaster
};