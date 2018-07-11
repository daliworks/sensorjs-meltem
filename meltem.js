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
function MeltemCVSMaster (id, port) {
  var self = this;

  self.id = id;
  self.config = {
    masterId: MELTEM_CVS_MASTER_ID,
    initializationFirst: true
  };

  self.serialPorts = [];
  self.listeners = [];
  self.devices = [];
  self.requestPool = {
    fastQueue: [],
    queue: [],
    sequence: 0,
    current: undefined
  };
  self.statistics = {
    init: {
      timeout: 0,
      done: 0
    },
  };
  self.log = {
    info: true,
    trace: true,
    error: true,
    callback: false
  };
  self.stop = true;
  self.port = port;

  self.loadConfig(CONFIG);

  self.logTrace('Create new instance :', self.getMasterID());

  EventEmitter.call(self);

  self.logTrace('port :', port);
  if (_.isNumber(port)) {
    self.startNetServer(port);
  }
  else {
    self.startSerialServer(port);
  }

  // Called when net server is connected.
  self.on('connect', function() {
    var self = this;

    self.stop = false;
    self.logInfo('Connected');
    if (self.config.initializationFirst) {
      self.initDevices().then(function() {
        self.emit('update');
      });
    }
    else {
      self.emit('update');
    }
  });

  self.on('disconnect', function() {
    var self = this;

    self.stop = true;
    self.logInfo('Disconnected');
    if (self.intervalHandler) {
      clearInterval(self.intervalHandler);
      self.intervalHandler = undefined;
    }
  });

  self.on('update', function() {
    var self = this;

    self.logTrace('update interval :', self.getUpdateInterval(), 'ms');

    self.updateDevices(self.getUpdateInterval(true)).then(function() {
      if (!self.stop) {
        self.emit('update');
      }
    });
  });

  self.on('data', function (payload) {
    var self = this;
    try {
      var masterId = payload.substr(1, 3);
      var deviceId = payload.substr(4, 3);
      var cmd      = payload.substr(7, 3);
   
      if (masterId !== self.getMasterID()) {
        throw new Error('Invalid MasterID[' + masterId + ']');
      }
  
      var device = _.find(self.devices, { id: deviceId});
      if (!device) {
        throw new Error('Invalid DeviceID[' + deviceId + ']');
      }
  
      var request = self.requestPool.current;
      if (request) {
        if (request.device !== device) {
          self.logTrace('Device[', deviceId, '] has received a delayed response.');
          device.responseCB(payload);
        }
        else {
          if (!request.current || request.current.name !== cmd) {
            throw new Error('Invalid Command[' + cmd + ']');
          }
    
          if (!device.responseCB(payload)) {
            throw new Error('Not supported command[' + cmd + ']');
          }
  
          if (request.current.timeoutHandler) {
            clearTimeout(request.current.timeoutHandler);
          }
  
          request.current = undefined;
        }
      }
    }
    catch(e) {
      self.logError(e);
      self.logError('Payload : ', payload);
    }
  });

  self.requestProcessHandler = setInterval(function() {
    if (!self.requestPool.current) {
      self.requestPool.current = self.requestPool.fastQueue.shift();
      if (!self.requestPool.current) {
        self.requestPool.current = self.requestPool.queue.shift();
        if (self.requestPool.current){
          self.logTrace('Get normal request');
        }
      }
      else {
        self.logTrace('Get fast request');
      }
    } 
    if (self.requestPool.current) {
      var request = self.requestPool.current;
 
      if (!request.current) {
        var message = request.messages.shift();
        if (message) {
          if (message.type === 'cmd') {
            var date = new Date();
            var payload = '<' + request.device.id + self.getMasterID() + message.payload + '>';
            self.logTrace(payload);
            message.requestTime = date.getTime();

            _.each(self.listeners, function(listener){
              listener.write(payload + '\r\n');
            });

            message.timeoutHandler = setTimeout(function() {
              self.logError('Timeout :', request.device.id, ',', request.device.requestTimeout);
              request.device.emit('timeout', request);
              if (self.requestPool.current === request) {
                self.requestPool.current = undefined;
              }
            }, request.device.requestTimeout);
  
            request.current = message;
          }
          else if (message.type === 'wait') {
            message.timeoutHandler = setTimeout(function() {
              self.logTrace('Wait :', request.device.id + ', ' + message.time);
              request.device.emit('waitDone', request);
              if (self.requestPool.current === request) {
                self.requestPool.current = undefined;
              }
            }, message.time);
            request.current = message;
          }
          else if (message.type === 'done') {
            request.device.emit('done', request);
            self.requestPool.current = undefined;
          }
        }
        else {
          self.requestPool.current = undefined;
        }
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

MeltemCVSMaster.prototype.logError = function() {
  var self = this;

  if (self.log.error) {
    var i;
    var message = self.id + ' :';

    for(i = 0 ; i < arguments.length ; i++) {
      if (_.isObject(arguments[i])) {
        message = message + ' ' + arguments[i];
      }
      else {
        message = message + ' ' + arguments[i];
      }
    }

    logger.error(message);
  }
};

MeltemCVSMaster.prototype.logTrace = function() {
  var self =  this;

  if (self.log.trace) {
    var i;
    var message = self.id + ' :';

    for(i = 0 ; i < arguments.length ; i++) {
      if (_.isObject(arguments[i])) {
        message = message + ' ' + arguments[i];
      }
      else {
        message = message + ' ' + arguments[i];
      }
    }

    logger.trace(message);
  }
};

MeltemCVSMaster.prototype.loadConfig = function(CONFIG) {
  var self = this;

  try {
    self.config.masterId = CONFIG.meltem.master.id || MELTEM_CVS_MASTER_ID;
  }
  catch(e) {
    self.config.masterId = MELTEM_CVS_MASTER_ID;
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

  self.logTrace('Config :', self.config);
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

      if (payload.length < 11) {
        self.parent.logError('Invalid Data : ', payload);
      }
      else if ((payload.substr(0, 1) !== START_OF_FRAME) || (payload.substr(payload.length - 1, 1) !== END_OF_FRAME)) {
        var startPosition = -1;
        var endPosition = -1;

        while(true) {
          startPosition = payload.indexOf(START_OF_FRAME, endPosition + 1);
          if (startPosition === -1) {
            break;
          }

          endPosition = payload.indexOf(END_OF_FRAME, startPosition + 1);
          if (endPosition === -1) {
            break;
          }

          var length = endPosition - startPosition + 1;
          if (length < 11) {
            break;
          }
          self.parent.emit('data', payload.substr(startPosition, length));
        }
      }
      else {
        self.parent.emit('data', payload);
      }
    });

    listener.on('end', function () {
      var self = this;

      clearInterval(listener.nextUpdateTimeout);
      self.parent.listeners = _.filter(self.parent.listeners, function(element) {
        return (element !== listener);
      });

      self.parent.logTrace('FIN received');
    });

    listener.on('close', function () {
      var self = this;

      clearInterval(listener.nextUpdateTimeout);
      self.parent.listeners = _.filter(self.parent.listeners, function(element) {
        return (element !== listener);
      });
      self.parent.logTrace('Socket closed');
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
      self.logError('Serial port error during opening :', err);
      return;
    } else {
      self.logTrace('No err, Connected');
    }

    self.server.on('error', function onError(err) {
      self.logError('Serial port error :', err);
      return;
    });

    self.server.on('close', function onClose(err) {
      if (err) {
        self.logError('Serial port error during closing :',  err);
        // TODO: if error, isn't this closed?
      } else {
        self.logTrace('Serial port is closed');
      }

      return;
    });

    self.server.on('disconnect', function onDisconnect(err) {
      self.logError('Serial port is disconnected :', err);

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

MeltemCVSMaster.prototype.initDevices = function() {
  var self = this;
  var deviceCount = self.devices.length;

  return new Promise(function(resolve) {
    _.each(self.devices, function(device) {
      device.init().then(function(response) { 
        deviceCount = deviceCount - 1;

        if (response === 'done') {
          self.statistics.init.done = self.statistics.init.done + 1;
          self.logTrace('Device[', device.id, '] connection is completed.');
        }
        if (response === 'timeout') {
          self.statistics.init.timeout = self.statistics.init.timeout + 1;
          self.logTrace('Device[', device.id, '] connection failed.');
        }

        var ratio = self.statistics.init.done * 100.0 / self.devices.length;
        self.logTrace('initialization Ratio [', self.statistics.init.done, ',', self.statistics.init.timeout, ',', ratio.toFixed(2), '% ]');

        if (deviceCount === 0) {
          resolve('done');
        }
      });
    });
  });
};

MeltemCVSMaster.prototype.updateDevices = function(timeout) {
  var self =this;

  return  new Promise(function(resolve) {
    var updateCount = self.devices.length;
    var stopUpdate = false;
    var timeoutList=[];
    var startTime = new Date().getTime();

    var timeoutHandler = setTimeout(function() {
      stopUpdate = true;
    }, timeout);

    self.logTrace('Set update timeout :', timeout);

    _.each(self.devices, function(device) {
      if (!self.stop) {
        device.update().then(function(result){
          if (result !== 'done') {
            timeoutList.push(device);
          }

          updateCount = updateCount - 1;
          if (updateCount === 0) {
            clearTimeout(timeoutHandler);
            var elapsedTime = new Date().getTime() - startTime;

            if ((elapsedTime < timeout) && (timeoutList.length !== 0)) {
              var retryDeviceCount = timeoutList.length;
              var retryTimeoutHandler = setTimeout(function() {
                stopUpdate = true;
              }, timeout - elapsedTime);
  
              _.each(timeoutList, function(device) {
                if (!self.stop) {
                  device.update().then(function(result) {
                    if (result !== 'done') {
                      self.logTrace('Device[', device.id, '] update retry failed.');
                    }

                    retryDeviceCount = retryDeviceCount - 1;
                    if (retryDeviceCount === 0) {
                      clearTimeout(retryTimeoutHandler);
                      self.logTrace('Update all devices!');
                      self.showStatistics();
                      resolve('done');
                    }
                  });
                }
              });
            }
            else {
              self.logTrace('Update all devices!');
              self.showStatistics();
              resolve('done');
            }
          }
          else if (stopUpdate){
            self.logError('Update timeout!');
            resolve('timeout');
          }
        });
      }
    });
  });
};

MeltemCVSMaster.prototype.showStatistics = function() {
  var self = this;

  self.logTrace('[STATICTICS]');

  self.logTrace('Initialization');
  self.logTrace('Done :', self.statistics.init.done);

  _.each(self.devices, function(device) {
    var statistics = device.getStatistics();

    var failureRatio = statistics.update.failure * 100.0 / statistics.update.total;
    self.logTrace(device.id, ',', statistics.update.total, ',', 
      (statistics.update.total - statistics.update.failure), ',', 
      statistics.update.failure, ',', 
      failureRatio.toFixed(2), '%,',  
      Math.trunc(statistics.responseTime.average), ',',
      statistics.responseTime.min, ',',
      statistics.responseTime.max);
  });
};

MeltemCVSMaster.prototype.fastRequest = function (device, request) {
  var self = this;

  request.device = device;
  self.requestPool.fastQueue.push(request);
};

MeltemCVSMaster.prototype.sendRequest = function (device, request) {
  var self = this;

  request.device = device;
  self.requestPool.queue.push(request);
};

MeltemCVSMaster.prototype.doneMessage = function(requestId, messageId) {
  var self = this;

  if (self.requestPool.current) {
    var request  = self.requestPool.current;
    if ((request.id === requestId) && request.current) {
      if (request.current.id === messageId) {
        clearTimeout(request.current.timeoutHandler); 
        request.current = undefined;
      }
    }
  }
};

MeltemCVSMaster.prototype.cancelRequest = function(requestId) {
  var self = this;

  if (self.requestPool.current) {
    var request  = self.requestPool.current;
    if (request.id === requestId){
      self.requestPool.current = undefined;
    }
  }
};

MeltemCVSMaster.prototype.getMasterID = function() {
  var self = this;
  return  self.config.masterId;
};

MeltemCVSMaster.prototype.getID = function() {
  var self = this;
  return  self.id;
};

MeltemCVSMaster.prototype.getUpdateInterval = function(renew) {
  var self = this;

  if (renew) {
    var newInterval = self.config.loopIntervalMin;

    _.each(self.devices, function(device){
      if (device.isInitialized()) {
        newInterval = newInterval + device.getRequestTimeout();
      }
      else {
        newInterval = newInterval + device.getInitTimeout();
      }
    });

    self.config.loopInterval = newInterval;
  }

  return  self.config.loopInterval;
};

MeltemCVSMaster.prototype.getRequestTimeout = function() {
  var self = this;

  return  self.config.requestTimeout;
};

function CreateMaster(id) {
  var master = _.find(masters, function(master) {
    return  master.id === id;
  });

  if (!master) {
    master = new MeltemCVSMaster(id, MELTEM_CVS_MASTER_PORT);
    masters.push(master);
  }

  return  master;
}

function DestroyMaster(id) {
  masters = _.filer(masters, function(master) {
    return  (master.id !== id);
  });
}

function  GetMaster(id) {
  return  _.find(masters, function(master) {
      return  (master.id === id);
  });
}

module.exports = {
  create: CreateMaster,
  destroy: DestroyMaster,
  get:  GetMaster
};