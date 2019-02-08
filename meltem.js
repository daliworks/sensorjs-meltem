'use strict';

var CONFIG = require('config');
var util = require('util');
var _ = require('lodash');
var net = require('net');
var EventEmitter = require('events').EventEmitter;
var Device = require('./meltemDevice');
var logger = require('./index').Sensor.getLogger('Sensor');

var MELTEM_CVS_MASTER_ID = '999';
var MELTEM_CVS_MASTER_PORT = 9000;
var LOOP_INTERVAL_MIN = 10000;
var REQUEST_TIMEOUT = 10000;
var START_OF_FRAME = '(';
var END_OF_FRAME = ')';

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
  self.initializeDone = false;
  self.initializeFailedList = [];
  self.updateFailedList = [];
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
    traffic: {
      inbound: 0,
      fragment: 0
    }
  };
  self.logLevel = {
    info: true,
    trace: true,
    error: true,
    fragment: false,
    payload: true,
    statistics: false,
    callback: false
  };
  self.stop = true;
  self.port = port;

  self.loadConfig(CONFIG);

  self.log('trace', 'Create new instance :', self.getMasterID());

  EventEmitter.call(self);

  self.log('trace', 'port :', port);
  self.startNetServer(port);

  // Called when net server is connected.
  self.on('connect', function(listener) {
    var self = this;
    self.log('info', 'Connected');

    if (self.listeners.length !== 0) {
      _.each(self.listeners, function (listener) {
        listener.parent = undefined;
        listener.emit('close');
      });

      self.listeners = [];

      if (self.updateTimeout) {
        clearTimeout(self.updateTimeout);
        self.updateTimeout = undefined;
      }
      self.initializeFailedList = [];
      self.updateFailedList = [];
      self.requestPool.fastQueue = [];
      self.requestPool.queue = [];
      self.requestPool.current = undefined;
    }

    _.each(self.devices, function (device) {
      device.emit('reset');
    });


    self.listeners.push(listener);

    self.stop = false;
    if (!self.initializeDone && self.config.initializationFirst) {
      self.initDevices(self.devices).then(function(failedList) {
        self.initializeDone = true;
        self.initializeFailedList = failedList;
        self.emit('update');
      });
    }
    else {
      self.emit('update');
    }
  });

  self.on('disconnect', function(listener) {
    var self = this;

    self.stop = true;
    self.log('info', 'Disconnected');

    self.log('trace', 'Listener count :', self.listeners.length);
    self.listeners = _.filter(self.listeners, function(element) {
      if (element !== listener) {
        return  true;
      } 
      else {
        self.log('trace', 'Listener found!');
        return false;
      }
    });
    self.log('trace', 'Listener count :', self.listeners.length);

    if (self.listeners.length === 0) {
      if (self.updateTimeout) {
        clearTimeout(self.updateTimeout);
        self.updateTimeout = undefined;
      }
      self.initializeFailedList = [];
      self.updateFailedList = [];
      self.requestPool.fastQueue = [];
      self.requestPool.queue = [];
      self.requestPool.current = undefined;
    }
  });

  self.on('update', function() {
    var self = this;

    self.updateTimeout = undefined;
    self.log('error', '################################################');
    self.log('trace', '# update interval :', self.getUpdateInterval(), 'ms #');
    self.log('error', '################################################');

    var  startTime = new Date().getTime();
    var  timeout = self.getUpdateInterval(true);

    self.updateDevices(self.devices).then(function(failedList) {
      var elapsedTime = new Date().getTime() - startTime;
      var remainTime = timeout - elapsedTime;
      var updateRetryList = [];

      self.log('error', '################################################');
      self.log('trace', '# Remain Time :', remainTime, 'ms #');
      self.log('error', '################################################');

      if (remainTime > 0) {
        _.each(failedList, function(device, index) {
          self.log('info', index, ':', device.id);
        });

        _.each(failedList, function(device) {
          if (device.getRequestTimeout() < remainTime ) {
            updateRetryList.push(device);
            remainTime = remainTime - device.getRequestTimeout();
          }
        });

        self.log('trace', 'Retry Count :', updateRetryList.length);
        self.updateDevices(updateRetryList).then(function() {
          var remainTime = timeout - (new Date().getTime() - startTime);

          self.log('trace', 'Update retry finished.[ Remain Time = ', remainTime, ']');

          self.updateTimeout = setTimeout(function() {
            self.emit('update');
          }, 10000);//remainTime);
        });
      }
    });
  });

  self.on('data', function (payload) {
    var self = this;
    try {
      self.log('trace', 'Recieved Frame :', payload);
      if (self.logLevel.payload) {
        self.log('trace', payload);
      }

      if (payload.length < 11) {
        throw new Error('Invalid payload');
      }

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
          self.log('trace', 'Device[', deviceId, '] has received a delayed response.');
          device.responseCB(payload, true);
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
      self.log('error', e);
      self.log('error', 'Payload :', payload);
    }
  });

  self.requestProcessHandler = setInterval(function() {
    if (!self.requestPool.current) {
      self.requestPool.current = self.requestPool.fastQueue.shift();
      if (!self.requestPool.current) {
        self.requestPool.current = self.requestPool.queue.shift();
      }
    } 

    if (self.requestPool.current) {
      var request = self.requestPool.current;
 
      if (!request.current) {
        var message = request.messages.shift();
        if (message) {
          switch(message.type)
          {
            case 'cmd': {
              var date = new Date();
              var payload = '<' + request.device.id + self.getMasterID() + message.payload + '>';
              if (self.logLevel.payload) {
                self.log('trace', payload);
              }
              message.requestTime = date.getTime();
  
              _.each(self.listeners, function(listener){
                self.log('trace', 'Send Frame :', payload);
                setTimeout(function() {
                  listener.write(payload);
                }, 2500);
              });
  
              message.timeoutHandler = setTimeout(function() {
                self.log('error', 'Timeout :', request.device.id, ',', request.device.requestTimeout);
                request.device.emit('timeout', request);
                if (self.requestPool.current === request) {
                  self.requestPool.current = undefined;
                }
                else {
                  self.log('error', 'The current request does not match.');
                }
              }, request.device.requestTimeout);
    
              request.current = message;
            }
            break;

            case 'wait': {
              message.timeoutHandler = setTimeout(function() {
                self.log('trace', 'Wait :', request.device.id + ', ' + message.time);
                request.device.emit('waitDone', request);
                if (self.requestPool.current === request) {
                  self.requestPool.current = undefined;
                }
                else {
                  self.log('error', 'The current request does not match.');
                }
              }, message.time);
              request.current = message;
            }
            break;

            case 'done': {
              request.device.emit('done', request);
              self.requestPool.current = undefined;
            }
            break;

            default: {
              self.log('error', 'Unknown message type', message.type);
            }
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

MeltemCVSMaster.prototype.log = function(level) {
  var self = this;

  if (self.logLevel[level] && logger[level]) {
    var i;
    var message = self.id + ' :';

    for(i = 1 ; i < arguments.length ; i++) {
      if (_.isObject(arguments[i])) {
        message = message + ' ' + arguments[i];
      }
      else {
        message = message + ' ' + arguments[i];
      }
    }

    logger[level](message);
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

  self.log('trace', 'Config :', self.config);
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
    master.log('trace', '##########################################');
    master.log('trace', 'Client connected.');
    master.log('trace', 'Remote Address :', listener.remoteAddress + ':' + listener.remotePort);
    master.log('trace', '##########################################');
  

    listener.parent = master;
    listener.buffer = [];
    listener.statistics = {
      traffic: {
        invalid: 0,
        fragment: 0,
        inbound: 0
      }
    };

    listener.setTimeout(300 * 1000);
    listener.on('data', function (data) {
      var self = this;
      if (_.isUndefined(self.parent)) {
        return;
      }

      try {
        master.log('trace', 'Recieved Frame :', data);
        self.statistics.traffic.inbound  = self.statistics.traffic.inbound + 1;

        var payload = new Buffer(data).toString().trim();
  
        if (self.buffer.length === 0) {
          if (payload.substr(0,1) !== START_OF_FRAME)  {
            self.statistics.traffic.invalid = self.statistics.traffic.invalid + 1;
            throw new Error('Invalid payload');
          }
          else {
            self.buffer = payload;
            if (self.buffer[self.buffer.length - 1] !== END_OF_FRAME) {
              self.statistics.traffic.fragment = self.statistics.traffic.fragment + 1;
              if (master.logLevel.fragment) {
                master.log('trace', 'Fragment data received! :', payload);
              }
            }
          }
        }
        else {
          if (payload.substr(0,1) === START_OF_FRAME)  {
            self.buffer = payload;
          }
          else {
            self.buffer = self.buffer + payload;
          }
  
          if (self.buffer[self.buffer.length - 1] !== END_OF_FRAME) {
            self.statistics.traffic.fragment = self.statistics.traffic.fragment + 1;
            if (master.logLevel.fragment) {
              master.log('trace', 'Fragment data received! :', payload);
            }
          }
        }
  
        if (self.buffer.length > 100) {
          self.buffer = [];
          self.statistics.traffic.invalid = self.statistics.traffic.invalid + 1;
          throw new Error('Invalid payload');
        }
  
        if ((self.buffer.substr(0, 1) !== START_OF_FRAME) || (self.buffer.substr(self.buffer.length - 1, 1) !== END_OF_FRAME)) {
          var startPosition = -1;
          var endPosition = -1;
  
          while(true) {
            startPosition = self.buffer.indexOf(START_OF_FRAME, endPosition + 1);
            if (startPosition === -1) {
              break;
            }
  
            endPosition = self.buffer.indexOf(END_OF_FRAME, startPosition + 1);
            if (endPosition === -1) {
              break;
            }
  
            var length = endPosition - startPosition + 1;
            self.buffer = self.buffer.substr(startPosition, length);
          }
        }

        if ((self.buffer.length >= 11) && (self.buffer.substr(0, 1) === START_OF_FRAME) && (self.buffer.substr(self.buffer.length - 1, 1) === END_OF_FRAME)) {
          master.emit('data', self.buffer, self);
          self.buffer = [];
          if (master.logLevel.lstatistics){
            master.log('trace', 'In :', self.statistics.traffic.inbound, ', Frag :', self.statistics.traffic.fragment, ', Invalid :', self.statistics.traffic.invalid);
          }
        }
        else {
          master.log('error', 'Invalid Frame :', self.buffer.length, self.buffer.substr(0, 1), self.buffer.substr(self.buffer.length - 1, 1));
        }
      }
      catch(e) {
        master.log('error', e);
      }
    });

    listener.on('timeout', function () {
      var self = this;

      master.log('error', 'Socket timeout');
      if (!_.isUndefined(self.parent)) {
        master.emit('disconnect', self); 
      }
    });

    listener.on('reset', function () {
      master.log('info', '##### Reset received #####');
    });

    listener.on('end', function () {
      master.log('error', 'FIN received');
    });

    listener.on('close', function () {
      var self = this;

      master.log('error', 'Socket closed');

      if (!_.isUndefined(self.parent)) {
        master.emit('disconnect', self);
      }
      self.end();
    });

    master.emit('connect', listener);
  });

  master.server.on('error', function(err) {
    var self = this;

    if (err.code === 'EADDRINUSE') {
      master.log('trace', 'Address in use, retrying...');

      setTimeout(function(){
        self.listen(port, function () {
          master.log('trace', 'Server listening for connection');
        });
      }, 1000);
    }
    else {
      master.log('error', 'master.server error! :', err.code);
    }
  });


  master.server.listen(port, function () {
    self.log('trace', 'Server listening for connection');
  });
};

MeltemCVSMaster.prototype.close = function () {
  var self = this;
  self.log('trace', 'Closing port');

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

MeltemCVSMaster.prototype.initDevices = function(devices) {
  var self = this;

  if (!devices) {
    devices = self.deivces;
  }

  var finishedDeviceCount = 0;
  var initDoneCount = 0;

  self.log('trace', 'Device initalization start!');
  return new Promise(function(resolve) {
    var failedList = [];

    _.each(devices, function(device) {
      device.init().then(function(response) { 
        if (response === 'done') {
          initDoneCount = initDoneCount + 1;
          self.log('trace', 'Device[', device.id, '] connection is completed.');
        }
        else {
          failedList.push(device);
          self.log('warn', 'Device[', device.id, '] connection failed.');
        }

        var ratio = initDoneCount * 100.0 / self.devices.length;
        self.log('trace', 'initialization Ratio [', initDoneCount, ',', failedList.length, ',', ratio.toFixed(2), '% ]');

        finishedDeviceCount = finishedDeviceCount + 1;

        if (finishedDeviceCount === devices.length) {
          resolve(failedList);
        }
      });
    });
  });
};

MeltemCVSMaster.prototype.updateDevices = function(devices) {
  var self =this;

  return  new Promise(function(resolve) {
    var updateFailedList = [];

    if (!devices) {
      devices = self.devices;
    }

    if (devices.length) {
      var updateFinished = 0;
      _.each(devices, function(device) {
        device.update().then(function(result) {
          updateFinished = updateFinished + 1;
          self.log('trace', 'Device[', device.id, '] update finished [', result, ']',  updateFinished, '/', devices.length, ']');
          if (result !== 'done') {
            updateFailedList.push(device);
          }
  
          if (devices.length === updateFinished) {
            resolve(updateFailedList);
          }
        });
      });
    }
    else{
      resolve(updateFailedList);
    }
  });
};

MeltemCVSMaster.prototype.showStatistics = function() {
  var self = this;

  self.log('trace', '[STATICTICS]');

  self.log('trace', 'Initialization');
  self.log('trace', 'Done :', self.statistics.init.done);

  _.each(self.devices, function(device) {
    var statistics = device.getStatistics();

    var failureRatio = statistics.update.failure * 100.0 / statistics.update.total;
    self.log('trace', device.id, ',', statistics.update.total, ',', 
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

  self.log('trace', 'Fast request called :', device.id);
  request.device = device;
  self.requestPool.fastQueue.push(request);
  self.log('info', 'Add New Fast Requets FastQueue :', self.requestPool.fastQueue.length, 'NormalQueue :', self.requestPool.queue.length);
};

MeltemCVSMaster.prototype.sendRequest = function (device, request) {
  var self = this;

  request.device = device;
  self.requestPool.queue.push(request);
  self.log('info', 'Add New Requets FastQueue :', self.requestPool.fastQueue.length, 'NormalQueue :', self.requestPool.queue.length);
};

MeltemCVSMaster.prototype.isCurrentRequest = function(request) {
  var self = this;

  return  (self.requestPool.current === request);
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

function CreateMaster(id, port) {
  if (!port) {
    port = MELTEM_CVS_MASTER_PORT;
  }

  id = id + ':' + port;
  var master = _.find(masters, { id: id});
  if (!master) {
    master = new MeltemCVSMaster(id, port);
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
  return  _.find(masters, { id: id});
}

module.exports = {
  create: CreateMaster,
  destroy: DestroyMaster,
  get:  GetMaster
};