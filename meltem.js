'use strict';

var CONFIG = require('config');
var util = require('util');
var _ = require('lodash');
var SerialPort = require('serialport');
var net = require('net');
var EventEmitter = require('events').EventEmitter;
var Device = require('./meltemDevice');
var logger = require('./index').Sensor.getLogger('Sensor');

var MELTEM_CVS_MASTER_ID = '999';
var MELTEM_CVS_MASTER_PORT = 9000;
var LOOP_INTERVAL_MIN = 10000;
var REQUEST_TIMEOUT = 5000;
var START_OF_FRAME = '(';
var END_OF_FRAME = ')';

var serialOpts = {
  baudRate: 115200,
  parity: 'none',
  parser: new SerialPort.parsers.Readline('\r\n'),
  autoOpen: false
};

//var SERIAL_PORT = '/dev/ttyS0';
var masters = [];

// TODO: If opening port takes long time, async function cannot be finished.
function MeltemCVSMaster (port) {
  var self = this;

  self.serialPorts = [];
  self.listeners = [];
  self.devices = [];
  self.messagePool = {
    fastQueue: [],
    queue: [],
    sequence: 0,
    current: undefined
  };
  self.statistics = {
    devices: {
      initialized: 0
    }
  };
  self.log = {
    info: true,
    trace: true,
    error: true,
    callback: false
  };

  self.port = port;
  self.logTrace('Create new instance : ' + port);

  self.loadConfig(CONFIG);

  self.logTrace('ID : ' + self.getID());

  EventEmitter.call(self);

  self.logTrace('port : ' + port);
  if (_.isNumber(port)) {
    self.startNetServer(port);
  }
  else {
    self.startSerialServer(port);
  }

  // Called when net server is connected.
  self.on('connect', function() {
    var self = this;
    var deviceCount = 0;
    var initWait = 0;

    self.logInfo('Connected');
    _.each(self.devices, function(device) {
      deviceCount = deviceCount+1;
      device.init().then(function(response) { 
        if (response === 'done') {
          self.statistics.devices.initialized = self.statistics.devices.initialized + 1;
          self.logTrace('Initialization done[ ' + self.statistics.devices.initialized + ' / ' + self.devices.length + ' ]');
        }
        deviceCount = deviceCount - 1;
      });
    });

    initWait = setInterval(function() {
      if (deviceCount === 0) {
        clearInterval(initWait);
        self.logTrace('initialized done');
        self.logTrace('update interval : ' + self.getUpdateInterval() + ' ms');

        self.intervalHandler = setInterval(function() {
          _.each(self.devices, function(device) {
            device.run();
          });
        }, self.getUpdateInterval());
      }
    }, 100);
  });

  self.on('disconnect', function() {
    var self = this;

    self.logInfo('Disconnected');
    if (self.intervalHandler) {
      clearInterval(self.intervalHandler);
      self.intervalHandler = undefined;
    }
  });

  self.on('data', function (payload) {
    var self = this;
    var masterId = payload.substr(1, 3);
 
    if (masterId !== self.getID()) {
      self.logTrace('Invalid Master ID : ' + masterId + ' != ' + self.getID());
      self.logTrace('Payload : ' + payload);
    }
    else {
      var slaveId = payload.substr(4, 3);

      self.devices.map(function (device) {
        if (device.id === slaveId) {
          device.emit('data', payload);
        }
      });
    }
  });

  self.messageProcessHandler = setInterval(function() {
    if (!self.messagePool.current) {
      var message;

      message = self.messagePool.fastQueue.shift();
      if (!message) {
        message = self.messagePool.queue.shift();
      }

      if (message && message.device) {
        var timeout;

        if (message.timeout) {
          timeout  = message.timeout;
        }
        else {
          timeout = self.config.requestTimeout;
        }

        _.each(self.listeners, function(listener){
          var payload = '<' + message.device.id + self.getID() + message.payload + '>\r\n';
          self.logTrace('Send : ' + payload);
          listener.write(payload);
        });

        message.timeoutHandler = setTimeout(function() {
          self.logError('Timed out : ' + message.device.id + ', ' + message.seq + ', ' + timeout);
          message.device.emit('timeout', message.seq);
        }, timeout);
        self.messagePool.current = message;
      }
    }
  }, 100);

}

util.inherits(MeltemCVSMaster, EventEmitter);

MeltemCVSMaster.prototype.logInfo= function(message) {
  var self = this;

  if (self.log.info) {
    logger.info('[' + self.constructor.name + ']', message);
  }
};

MeltemCVSMaster.prototype.logError = function(error) {
  var self = this;

  if (self.log.error) {
    if (_.isString(error)) {
      logger.error('[' + self.constructor.name + ']', error);
    }
    else {
      if (self.log.callstack || !error.message) {
        logger.error('[' + self.constructor.name + ']', error);
      }
      else {
        logger.error('[' + self.constructor.name + ']', error.message);
      }
    }
  }
};

MeltemCVSMaster.prototype.logTrace = function(message) {
  var self = this;

  if (self.log.trace) {
    logger.trace('[' + self.constructor.name + ']', message);
  }
};

MeltemCVSMaster.prototype.loadConfig = function(CONFIG) {
  var self = this;

  self.config = {};

  try {
    self.config.id = CONFIG.meltem.master.id || MELTEM_CVS_MASTER_ID;
  }
  catch(e) {
    self.config.id = MELTEM_CVS_MASTER_ID;
  }

  try {
    self.config.requestTimeout = CONFIG.meltem.master.responseTimeout || REQUEST_TIMEOUT;
  }
  catch(e){
    self.config.requestTimeout = REQUEST_TIMEOUT;
  }

  try {
    self.config.loopIntervalMin = CONFIG.meltem.master.loopIntervalMin || LOOP_INTERVAL_MIN;
  }
  catch(e) {
    self.config.loopIntervalMin = LOOP_INTERVAL_MIN;
  }

  if (self.config.loopInterval < self.config.loopIntervalMin) {
    self.config.loopInterval = self.config.loopIntervalMin;
  }

  self.logTrace('Config : ' + self.config);
  try {
    self.config.port = [];
    if (CONFIG.meltem.master.port) {
      if (_.isArray(CONFIG.meltem.master.port)) {
        self.config.port = CONFIG.meltem.master.port; 
      }
      else {
        self.config.port.push(CONFIG.meltem.master.port); 
      }
    }
  }
  catch(e) {
    self.config.port = [MELTEM_CVS_MASTER_PORT];
  }
};

MeltemCVSMaster.prototype.startNetServer = function(port) {
  var self = this;
  var master = this;

  self.server = net.createServer(function (listener) {
    self.logTrace('Client connected.');
    master.listeners.push(listener);

    listener.parent = master;

    listener.on('data', function (data) {
      var self = this;
      var payload = new Buffer(data).toString().trim();

      if ((payload.length < 11) || (payload.substr(0, 1) !== START_OF_FRAME) || (payload.substr(payload.length - 1, 1) !== END_OF_FRAME)) {
        self.logError('Invalid Data : ' + payload);
      }
      else {
        self.parent.emit('data', payload);
      }
    });

    listener.on('end', function () {
      clearInterval(listener.nextUpdateTimeout);
      self.parent.listeners = _.filter(self.parent.listeners, function(element) {
        return (element !== listener);
      });

      self.logTrace('FIN received');
    });

    listener.on('close', function () {
      clearInterval(listener.nextUpdateTimeout);
      self.parent.listeners = _.filter(self.parent.listeners, function(element) {
        return (element !== listener);
      });
      self.logTrace('Socket closed');
    });

    master.emit('connect');
  });

  master.server.listen(port, function () {
    self.logTrace('Server listening for connection');
  });
};

MeltemCVSMaster.prototype.openSerialServer = function(name) {
  var self = this;

  self.server = new SerialPort(name, serialOpts);
  self.server.open(function(err) {
    self.logTrace('Connected');

    if (err) {
      self.logError('Serial port error during opening :' + err);
      return;
    } else {
      self.logTrace('No err, Connected');
    }

    self.server.on('error', function onError(err) {
      self.logError('Serial port error :' + err);
      return;
    });

    self.server.on('close', function onClose(err) {
      if (err) {
        self.logError('Serial port error during closing :' +  err);
        // TODO: if error, isn't this closed?
      } else {
        self.logTrace('Serial port is closed');
      }

      return;
    });

    self.server.on('disconnect', function onDisconnect(err) {
      self.logError('Serial port is disconnected : ' + err);

      return;
    });

    self.server.on('data', function onData(data) {
      self.onData(data);
    });
  });
};

MeltemCVSMaster.prototype.close = function () {
  var self = this;
  self.logTrace('Closing port');

  if (self.server) {
    self.server.close();
    self.server = undefined;
  }
};

MeltemCVSMaster.prototype.addDevice = function(id) {
  var self = this;
  var device;

  device = self.getDevice(id);
  if (!device) {
    device = Device.create(self, id);
    if (device) {
      self.devices.push(device);
  
      self.config.loopInterval = self.config.loopIntervalMin;
      _.each(self.devices, function(device){
        self.config.loopInterval = self.config.loopInterval + device.getRequestTimeout();
      });
    }
  }

  return  device;
};

MeltemCVSMaster.prototype.getDevice = function(id) {
  var self = this;

  return  _.find(self.devices, function(device){
    return  (device.id === id);
  });
};

MeltemCVSMaster.prototype.sendFastMessage = function (device, msgId, payload, timeout) {
  var self = this;

  self.messagePool.sequence = self.messagePool.sequence + 1;
  var message = {
    seq: self.messagePool.sequence,
    device: device,
    msgId : msgId,
    payload: payload,
    timeout: timeout,
    timeoutHandler: undefined
  };

  if (!message.timeout) {
    message.timeout = self.requestTiemout;
  }

  self.logTrace('Push to the fast queue');
  self.messagePool.fastQueue.push(message);

  return  message.seq;
};

MeltemCVSMaster.prototype.sendMessage = function (device, msgId, payload, timeout) {
  var self = this;

  self.messagePool.sequence = self.messagePool.sequence + 1;
  var message = {
    seq: self.messagePool.sequence,
    device: device,
    msgId : msgId,
    payload: payload,
    timeout: timeout,
    timeoutHandler: undefined
  };

  if (!message.timeout) {
    message.timeout = self.requestTiemout;
  }

  self.messagePool.queue.push(message);

  return  message.seq;
};

MeltemCVSMaster.prototype.doneMessage = function(seq) {
  var self = this;

  if (self.messagePool.current) {
    if (self.messagePool.current.seq === seq) {
      clearTimeout(self.messagePool.current.timeoutHandler); 
      self.messagePool.current = undefined;
    }
  }
};

MeltemCVSMaster.prototype.cancelMessage = function(seq) {
  var self = this;

  if (self.messagePool.current) {
    if (self.messagePool.current.seq === seq) {
      clearTimeout(self.messagePool.current.timeoutHandler); 
      self.messagePool.current = undefined;
    }
  }
};

MeltemCVSMaster.prototype.getID = function() {
  var self = this;
  return  self.config.id;
};

MeltemCVSMaster.prototype.getUpdateInterval = function() {
  var self = this;

  return  self.config.loopInterval;
};

MeltemCVSMaster.prototype.getRequestTimeout = function() {
  var self = this;

  return  self.config.requestTimeout;
};

function CreateMaster(port) {
  if (!port) {
    port = MELTEM_CVS_MASTER_PORT;
  }

  var master = _.find(masters, function(master) {
    return  master.port === port;
  });

  if (!master) {
    master = new MeltemCVSMaster(port);
    masters.push(master);
  }

  return  master;
}

function DestroyMaster(port) {
  masters = _.filer(masters, function(master) {
    return  (master.port !== port);
  });
}

function  GetMaster(port) {
  return  _.find(masters, function(master) {
      return  (master.port === port);
  });
}

module.exports = {
  create: CreateMaster,
  destroy: DestroyMaster,
  get:  GetMaster
};