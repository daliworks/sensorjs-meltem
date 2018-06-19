'use strict';

var util = require('util');
var _ = require('lodash');
var SerialPort = require('serialport');
var net = require('net');
var EventEmitter = require('events').EventEmitter;
var Device = require('./meltemDevice');
var logger = require('./index').Sensor.getLogger('Sensor');

var MELTEM_CVS_MASTER_ID = '999';
var LOOP_INTERVAL_MIN = 60000;
var REQUEST_INTERVAL_MIN = 1000;
var RESPONSE_WAITING_TIME = 5000;

var serialOpts = {
  baudRate: 115200,
  parity: 'none',
  parser: SerialPort.parsers.readline('\r\n'),
  autoOpen: false
};

var START_OF_FRAME = '(';
var END_OF_FRAME = ')';
//var SERIAL_PORT = '/dev/ttyS0';
var NET_PORT  = 9000;
var masters = [];

// TODO: If opening port takes long time, async function cannot be finished.
function MeltemCVSMaster (port) {
  var self = this;

  self.id = MELTEM_CVS_MASTER_ID;
  self.serialPorts = [];
  self.listeners = [];
  self.devices = [];
  self.requestPool = [];
  self.loopIntervalMin = LOOP_INTERVAL_MIN;
  self.requestIntervalMin = REQUEST_INTERVAL_MIN;
  self.responseWaitingTime = RESPONSE_WAITING_TIME;
  self.requestDate = 0;
  self.port = port;

  EventEmitter.call(self);

  logger.trace('[Meltem CVS] port : ', port);
  if (_.isNumber(port)) {
    self.startNetServer(port);
  }
  else {
    self.startSerialServer(port);
  }

  self.on('update', function() {
    var request = self.requestPool.shift();
    if (request) {
      request.device.emit(request.cmd, request);
    }
  });
}

util.inherits(MeltemCVSMaster, EventEmitter);

MeltemCVSMaster.prototype.startNetServer = function(port) {
  var self = this;

  self.server = net.createServer(function (listener) {
    logger.trace('[Meltem CVS] Client connected.');
    self.listeners.push(listener);

    listener.index  = 0;
    listener.parent = self;
    listener.startDate = new Date();
    listener.timeout   = listener.startDate.getTime();
    listener.loopInterval = listener.parent.loopIntervalMin;

    listener.on('data', function (data) {
      self.onData(data);
    });

    listener.on('end', function () {
      self = this;

      clearInterval(listener.nextUpdateTimeout);
      var i;
      for (i = 0; i < self.parent.listeners.length; i++) {
        if (self.parent.listeners[i] === listener) {
          self.parent.listeners.splice(i, 1);
          break;
        }
      }
      logger.trace('FIN received');
    });

    listener.on('close', function () {
      clearInterval(listener.nextUpdateTimeout);
      var i;
      for (i = 0; i < self.parent.listeners.length; i++) {
        if (self.parent.listeners[i] === listener) {
          self.parent.listeners.splice(i, 1);
          break;
        }
      }
      logger.trace('Socket closed');
    });

    listener.on('update', function(){
      if (self.requestPool.length) {
        self.updateStartTime = new Date();

        _.each(self.parent.devices, function(device) {
          self.requestPool.push( { device: device, cmd: 'update'} );
        });

        self.emit('update');
      }
    });
  });

  self.server.listen(port, function () {
    logger.trace('[Meltem CVS] Server listening for connection');
  });
};

MeltemCVSMaster.prototype.openSerialServer = function(name) {
  var self = this;

  self.server = new SerialPort(name, serialOpts);
  self.server.open(function(err) {
    logger.trace('[Meltem CVS] Connected');

    if (err) {
      logger.error('Serial port error during opening:', err);
      return;
    } else {
      logger.trace('[Meltem CVS] No err, Connected');
    }

    self.server.on('error', function onError(err) {
      logger.error('Serial port error:', err);
      return;
    });

    self.server.on('close', function onClose(err) {
      if (err) {
        logger.error('Serial port error during closing:', err);
        // TODO: if error, isn't this closed?
      } else {
        logger.trace('Serial port is closed');
      }

      return;
    });

    self.server.on('disconnect', function onDisconnect(err) {
      logger.error('Serial port is disconnected:', err);

      return;
    });

    self.server.on('data', function onData(data) {
      self.onData(data);
    });
  });
};

MeltemCVSMaster.prototype.close = function () {
  var self = this;
  logger.trace('Closing port');

  if (self.server) {
    self.server.close();
    self.server = undefined;
  }
};

MeltemCVSMaster.prototype.onData = function (data) {
  var self = this;
  var payload = new Buffer(data).toString();

  if ((payload.length < 11) || (payload.substr(0, 1) !== START_OF_FRAME) || (payload.substr(payload.length - 1, 1) !== END_OF_FRAME)) {
    logger.error('Invalid data', payload);
    return;
  }

  var masterId = parseInt(payload.substr(1, 3));
 
  if (masterId !== self.id) {
    logger.error('Invalid Master ID : ', payload);
    return;
  }

  var slaveId = parseInt(payload.substr(4, 3));

  self.parent.devices.map(function (device) {
    if (device.id === slaveId) {
      device.emit(payload.substr(7, 3), payload);
    }
  });
};

MeltemCVSMaster.prototype.addDevice = function(id) {
  var self = this;
  var i;
  var device = {};

  for(i = 0 ; i < self.devices.length ; i++) {
    if (self.devices[i].id === id) {
      return self.devices[i];
    }
  }

  device = Device.create(self, id);
  self.devices.push(device);

  return  device;
};

MeltemCVSMaster.prototype.getDevice = function(id) {
  var self = this;
  var i;

  for(i = 0 ; i < self.devices.length ; i++) {
    if (self.devices[i].id === id) {
      return self.devices[i];
    }
  }

  return undefined;
};

MeltemCVSMaster.prototype.sendMessage = function (id, message) {
  var   self = this;
  var   i;
  var   date = new Date();
  var   timeGap = date.getTime() - self.requestDate;

  if (timeGap >= self.requestIntervalMin) {
      timeGap = self.requestIntervalMin;
  }

  setTimeout(function () {
    self.requestDate = date;
    for (i = 0; i < self.listeners.length; i++) {
      logger.trace('Send Message : <' + id + self.id + message + '>');
      self.listeners[i].write('<' + id + self.id + message + '>\r\n');
    }
  }, self.requestIntervalMin - timeGap);
};

function CreateMaster(port) {
  var i;

  if (!port) {
    port = NET_PORT;
  }

  for(i = 0 ; i < masters.length ; i++)
  {
      if (masters[i].port === port)
      {
          return  masters[i];
      }
  }

  logger.trace('[Meltem CVS] Create new instance : ', port);

  var master = new MeltemCVSMaster(port);

  masters.push(master);

  return  master;
}

function DestroyMaster(port) {
  var i;
  var basePort;

  basePort = parseInt(port) / 100 * 100;

  for(i = 0 ; i < masters.length ; i++)
  {
      if (masters[i].port === basePort)
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
      if (masters[i].port === basePort)
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