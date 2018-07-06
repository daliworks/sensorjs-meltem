'use strict';

var CONFIG = require('config');
var util = require('util');
var _ = require('lodash');
var EventEmitter = require('events').EventEmitter;
var logger = require('./index').Sensor.getLogger('Sensor');

var STEP_TABLE = [
  { 'name' : 'S1', 'step' : 0},
  { 'name' : 'T1', 'step' : 1},
  { 'name' : 'T2', 'step' : 2},
  { 'name' : 'T3', 'step' : 3},
  { 'name' : 'R1', 'step' : 4},
  { 'name' : 'R2', 'step' : 5},
  { 'name' : 'R3', 'step' : 6},
  { 'name' : 'F1', 'step' : 7}
];

var SETTINGS1_NAME = [ 's01', 's02', 's03', 's04', 's05', 's06', 's07', 's08', 's09', 's10', 's11', 's12' ]; 
var SETTINGS2_NAME = [ 's13', 's14', 's15', 's16', 's17', 's18', 's19', 's20', 's21', 's22', 's23', 's24' ]; 
var SETTINGS3_NAME = [ 'set1Rpm', 'set1Current', 'set2Rpm', 'set2Current', 'set3Rpm', 'set3Current', 'set3OpenRpm', 'set3OpenCurrent'];

var SETTINGS_NAME = [
  's01', 's02', 's03', 's04', 's05', 's06', 's07', 's08', 's09', 's10', 's11', 's12' , 
  's13', 's14', 's15', 's16', 's17', 's18', 's19', 's20', 's21', 's22', 's23', 's24', 
  'set1Rpm', 'set1Current', 'set2Rpm', 'set2Current', 'set3Rpm', 'set3Current', 'set3OpenRpm', 'set3OpenCurrent'
];

var DEFAULT_SETTINGS = {
  s01: { value: 1,    new: false, setCommand: 'S01', min: 0,    max:998,  readOnly: true },
  s02: { value: 2,    new: false, setCommand: 'S02', min: 1,    max:9   },
  s03: { value: 0,    new: false, setCommand: 'S03', min: 0,    max:1   },
  s04: { value: 3,    new: false, setCommand: 'S04', min: 1,    max:30  },
  s05: { value: 270,  new: false, setCommand: 'S05', min: 0,    max:999 },
  s06: { value: 100,  new: false, setCommand: 'S06', min: 0,    max:999 },
  s07: { value: 80,   new: false, setCommand: 'S07', min: 0,    max:999 },
  s08: { value: 60,   new: false, setCommand: 'S08', min: 0,    max:999 },
  s09: { value: 40,   new: false, setCommand: 'S09', min: 0,    max:999 },
  s10: { value: 5,    new: false, setCommand: 'S10', min: 0,    max:999 },
  s11: { value: 1,    new: false, setCommand: 'S11', min: 0,    max:999 },
  s12: { value: 1750, new: false, setCommand: 'S12', min: 0,    max:9999 },
  s13: { value: -100, new: false, setCommand: 'S13', min: -500, max:0 },
  s14: { value: 2,    new: false, setCommand: 'S14', min: 0,    max:999 },
  s15: { value: 10,   new: false, setCommand: 'S15', min: 0,    max:999 },
  s16: { value: 20,   new: false, setCommand: 'S16', min: 0,    max:999 },
  s17: { value: -180, new: false, setCommand: 'S17', min: -500, max:0 },
  s18: { value: 3,    new: false, setCommand: 'S18', min: 0,    max:999 },
  s19: { value: 120,  new: false, setCommand: 'S19', min: 0,    max:999 },
  s20: { value: 150,  new: false, setCommand: 'S20', min: 0,    max:999 },
  s21: { value: 30,   new: false, setCommand: 'S21', min: 0,    max:999 },
  s22: { value: -250, new: false, setCommand: 'S22', min: -500, max:0 },
  s23: { value: 10,   new: false, setCommand: 'S23', min: 0,    max:999 },
  s24: { value: 30,   new: false, setCommand: 'S24', min: 0,    max:999 },
  set1Rpm:        { value: 0, new: false, setCommand: 'T01', min: 0, max:9999 },
  set1Current:    { value: 0, new: false, setCommand: 'T02', min: 0, max:9999 },
  set2Rpm:        { value: 0, new: false, setCommand: 'T03', min: 0, max:9999 },
  set2Current:    { value: 0, new: false, setCommand: 'T04', min: 0, max:9999 },
  set3Rpm:        { value: 0, new: false, setCommand: 'T05', min: 0, max:9999 },
  set3Current:    { value: 0, new: false, setCommand: 'T06', min: 0, max:9999 },
  set3OpenRpm:    { value: 0, new: false, setCommand: 'T07', min: 0, max:9999 },
  set3OpenCurrent:{ value: 0, new: false, setCommand: 'T08', min: 0, max:9999 }
};

function valueToString (setting, value) {
  var   s;

  if (!value) {
    value = setting.value;
  }
  else if (value < setting.min) {
    value = setting.min;
  }
  else if (value > setting.max) {
    value = setting.max;
  }

  if (value < 0) {
    s = Math.trunc(Math.abs(value)).toString();

    return  '-' + Array( 3-s.length+1 ).join('0') + s;
  }
  else {
    s = value.toString();

    return  Array( 4-s.length+1 ).join('0') + s;
  }
}

function MeltemCVSDevice(master, id) {
  var self = this;

  self.id = id;
  self.master = master;
  self.requestTimeout = 5000;
  self.messagePool = {
    fastQueue: [],
    queue: []
  };
  self.groupStatus = [{
      initialized: false 
    },{
      initialized: false 
    },{
      initialized: false 
    }
  ];

  self.statistics = {
    update: {
      total: 0,
      failure: 0
    },
    request: {
      total: 0,
      succss: 0,
      failure: 0
    }
  };
  self.log = {
    trace: true,
    error: true,
    callstack: false
  };

  self.settings = self.getDefaultSettings();

  self.commandSet = [ 
    { 
      name : 'D00', 
      action : function(message, data) {
        self.logTrace('View current status.');

        try {
          if (!message || !_.isString(data) || data.length !== 34) {
            throw new Error('Invalid Data : ' + data);
          }

          var stepObject = _.find(STEP_TABLE, { 'name' : data.substr(22, 2)});
          if (!stepObject) {
            throw new Error('Invalid Step : ' + data.substr(22, 2));
          }

          var pressure = parseInt(data.substr(10, 4));
          var rpm = parseInt(data.substr(14, 4));
          var current = parseInt(data.substr(18, 4));
          var power = current*24/1000;
          var temperature = parseInt(data.substr(24, 4));
          var operatingTime = parseInt(data.substr(28, 5));

          self.master.emit(self.id + '-mode', { sequence: 'mode', value: stepObject.step });
          self.master.emit(self.id + '-pressure', { sequence: 'pressure', value: pressure });
          self.master.emit(self.id + '-rpm', { sequence: 'rpm', value: rpm });
          self.master.emit(self.id + '-current', { sequence: 'current', value: current });
          self.master.emit(self.id + '-power', { sequence: 'power', value: power });
          self.master.emit(self.id + '-temperature', { sequence: 'temperature', value: temperature });
          self.master.emit(self.id + '-operating_time', { sequence: 'operating_time', value: operatingTime});
        }
        catch(e) {
          self.logError(e);
        }
      }
    },
    {
      name : 'D60',
      action : function(message, data) {
        self.logTrace('View setting part 1.');

        try {
          if (!message || !_.isString(data) || data.length !== 59) {
            throw new Error('Invalid Data : ' + data);
          }

          _.each(SETTINGS1_NAME, function(name, i) {
            self.settings[name].value  = parseInt(data.substr(10 + i * 4, 4));
          });

          self.groupStatus[0].initialized = true;
        }
        catch(e) {
          self.logError(e);
        }
      }
    },
    {
      name : 'D61',
      action : function(message, data) {
        self.logTrace('View setting part 2.');

        try {
          if (!message || !_.isString(data) || data.length !== 59) {
            throw new Error('Invalid Data : ' + data);
          }
      
          _.each(SETTINGS2_NAME, function(name, i) {
              self.settings[name].value = parseInt(data.substr(10 + i * 4, 4));
          });

          self.groupStatus[1].initialized = true;
         }
        catch(e) {
          self.logError(e);
        }
      }
    },
    {
      name : 'D70',
      action : function(message, data) {
        self.logTrace('View test setting.');
     
        try {
          if (!message || !_.isString(data) || data.length !== 43) {
            throw new Error('Invalid Data : ' + data);
          }
      
          _.each(SETTINGS3_NAME, function(name, i) {
              self.settings[name].value = parseInt(data.substr(10 + i * 4, 4));
          });

          self.groupStatus[2].initialized = true;
        }
        catch(e) {
          self.logError(e);
        }
      }
    },
    {
      name : 'S60',
      action : function(message, data) {
        self.logTrace('Set setting part 1.');

        try {
          if (!message || !_.isString(data) || data.length !== 59) {
            throw new Error('Invalid Data : ' + data);
          }

          _.each(SETTINGS1_NAME, function(name, i) {
            self.settings[name].value = parseInt(data.substr(10 + i * 4, 4));
          });

          self.groupStatus[0].initialized = true;
        }
        catch(e) {
          self.logError(e);
        }
      }
    },
    {
      name : 'S61',
      action : function(message, data) {
        self.logTrace('Set setting part 2.');

        try {
          if (!message || !_.isString(data) || data.length !== 59) {
            throw new Error('Invalid Data : ' + data);
          }
      
          _.each(SETTINGS2_NAME, function(name, i) {
            self.settings[name].value = parseInt(data.substr(10 + i * 4, 4));
          });

          self.groupStatus[1].initialized = true;
        }
        catch(e) {
          self.logError(e);
        }
      }
    },
    {
      name : 'S70',
      action : function(message, data) {
        self.logTrace('View test setting.');
      
        try {
          if (!message || !_.isString(data) || data.length !== 43) {
            throw new Error('Invalid Data : ' + data);
          }

          _.each(SETTINGS3_NAME, function(name, i) {
            self.settings[name].value = parseInt(data.substr(10 + i * 4, 4));
          });

          self.groupStatus[2].initialized = true;
        }
        catch(e) {
          self.logError(e);
        }
      } 
    }
  ];

  EventEmitter.call(self);

  self.logTrace('Device : ' + self);

  self.on('data', function(data) {
    try{
      self.logTrace('onData : ' + data);

      if ((!self.messagePool.current) || (data.length < 11)) {
        throw new Error('Invalid Data');
      }
      
      var command = _.find(self.commandSet , { 'name' : data.substr(7, 3)});
      if (!command) {
        throw new Error('Invalid command');
      }

      command.action(self.messagePool.current, data);
      self.master.doneMessage(self.messagePool.current.seq);
      self.messagePool.current = undefined;
      self.statistics.request.succss = self.statistics.request.success + 1;
    }
    catch(e) {
      self.logError(e);
    }
  });

  self.on('control', function(params, cb){
    var result = {};

    try {
      if (!self.initialized) {
        throw new Error('The device is not initialized.');
      }

      self.logTrace('Device Control : ' + params);
      if (params.cmd === 'set') {
        if (!params.settings || !self.setSettings(params.settings, cb)) { 
          throw new Error('The parameter is incorrect.');
        }
      }
      else if (params.cmd === 'get') {
        result.settings = self.getSettings();
        self.logTrace('Request GET result : ' + result);
      }
      else {
        throw new Error('This command is not supported.');
      }

      result.result = 'success';
      return cb && cb(undefined, JSON.stringify(result));
    }
    catch(e) {
      result.result = 'failed';
      result.message = e.message;
      return cb && cb(JSON.stringify(result));
    }
  });
  
  self.on('timeout', function(seq) {
    try {
      if (self.messagePool.current.seq !== seq) {
        throw new Error('Occurred timeout but seq mismatch : ' + self.messagePool.current.seq + ' !== ' + seq);
      }

      self.master.cancelMessage(self.messagePool.current.seq);
      if (self.messagePool.current.timeoutCB) {
        self.messagePool.current.timeoutCB();
      }

      var message = 'Request Timeout : ' + self.id + ' ' + self.messagePool.current.name;

      self.messagePool.current = undefined;
      self.messagePool.fastQueue = [];
      self.messagePool.queue = [];
      self.statistics.request.failure = self.statistics.request.failure + 1;

      throw new Error(message);
    }
    catch(e) {
      self.logError(e);
    }
  });

  setInterval(function() {
    if (!self.messagePool.current) {
      var message = self.messagePool.fastQueue.shift();
      if (!message) {
        message = self.messagePool.queue.shift();
      }

      if (message) {
        if (message.type === 'cmd') {
          self.statistics.request.total = self.statistics.request.total + 1;
          if (message.fast) {
            message.seq = self.master.sendFastMessage(self, message.msgId, message.payload, self.requestTimeout);
          }
          else {
            message.seq = self.master.sendMessage(self, message.msgId, message.payload, self.requestTimeout);
          }

          self.messagePool.current = message;
        }
        else if (message.type === 'done') {
          return (message.cb) && message.cb();
        }
      }
    }
  }, 100);
}

util.inherits(MeltemCVSDevice, EventEmitter);

MeltemCVSDevice.prototype.logError = function(error) {
  var self =  this;

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

MeltemCVSDevice.prototype.logTrace = function(message) {
  var self =  this;

  if (self.log.trace) {
    logger.trace('[' + self.constructor.name + ']', message);
  }
};

MeltemCVSDevice.prototype.getDefaultSettings = function() {
  var settings = _.clone(DEFAULT_SETTINGS);

  try{
    _.each(SETTINGS_NAME, function(name) {
      if (CONFIG.meltem.config[name]) {
        if (CONFIG.meltem.config[name].min) {
          settings[name].min = CONFIG.meltem.config[name].min;
        }

        if (CONFIG.meltem.config[name].max) {
          settings[name].max = CONFIG.meltem.config[name].max;
        }
      }
    });
  }
  catch(e) {
  }

  return  settings;
};

MeltemCVSDevice.prototype.getRequestTimeout = function() {
  var   self = this;

  return  self.requestTimeout;
};

MeltemCVSDevice.prototype.init = function () {
  var self = this;

  return new Promise(function(resolve) {
    var date = new Date();
    
    var messages = [];

    if (!self.groupStatus[0].initialized) {
      messages.push({
        type: 'cmd',
        msgId : date.getMilliseconds(),
        name: 'D60',
        payload: 'D60',
        timeoutCB : function() {
          self.logTrace('Group 1 initialization failed');
          resolve('timeout');
        }
      });
    }

    if (!self.groupStatus[1].initialized) {
      messages.push({
        type: 'cmd',
        msgId : date.getMilliseconds() + 1,
        name: 'D61',
        payload: 'D61',
        timeoutCB : function() {
          self.logTrace('Group 2 initialization failed');
          resolve('timeout');
        }
      });
    }

    if (!self.groupStatus[2].initialized) {
      messages.push({
        type: 'cmd',
        msgId : date.getMilliseconds() + 2,
        name: 'D70',
        payload: 'D70',
        timeoutCB : function() {
          self.logTrace('Group 3 initialization failed');
          resolve('timeout');
        }
      });
    }
  
    messages.push({
      type: 'done',
      cb: function () {
        self.initialized = true;
        resolve('done');
      }
    });

    self.postMessage(messages);
  });
};

MeltemCVSDevice.prototype.update = function () {
  var self = this;

  return new Promise(function(resolve) {
    var date = new Date();
    self.statistics.update.total = self.statistics.update.total + 1;
    self.postMessage([{
        type: 'cmd',
        msgId : date.getMilliseconds(),
        name: 'D00',
        payload: 'D00',
        timeoutCB : function() {
          self.statistics.update.failure = self.statistics.update.failure + 1;
          var failureRatio = self.statistics.update.failure * 100.0 / self.statistics.update.total;

          var message = 'State update faile [ ';
          message = message + self.statistics.update.total;
          message = message + ' / ';
          message = message + self.statistics.update.total - self.statistics.update.failure;
          message = message + ' / ';
          message = message + self.statistics.update.failure;
          message = message + ' / ';
          message = message + failureRatio.toFixed(2);
          message = message + ' % ]';
          self.logTrace(message);
          resolve('timeout');
        }
      },
      {
        type: 'done',
        cb: function () {
          resolve('done');
        }
      }
    ]);
  });
};

MeltemCVSDevice.prototype.run = function () { 
  var self = this;

  if (!self.initialized) {
    return  self.init();
  }
  else {
    return  self.update();
  }
};

MeltemCVSDevice.prototype.isSettings1 = function(settings) {
  return  ( settings.s01 || 
            settings.s02 ||
            settings.s03 ||
            settings.s04 ||
            settings.s05 ||
            settings.s06 ||
            settings.s07 ||
            settings.s08 ||
            settings.s09 ||
            settings.s10 ||
            settings.s11 ||
            settings.s12);
};

MeltemCVSDevice.prototype.isSettings2 = function(settings) {
  return  ( settings.s13 ||
            settings.s14 ||
            settings.s15 ||
            settings.s16 ||
            settings.s17 ||
            settings.s18 ||
            settings.s19 ||
            settings.s20 ||
            settings.s21 ||
            settings.s22 ||
            settings.s23 ||
            settings.s24);
};

MeltemCVSDevice.prototype.isSettingsTest = function(settings) {
  return  ( settings.set1Rpm ||
            settings.set1Current ||
            settings.set2Rpm ||
            settings.set2Current ||
            settings.set3Rpm ||
            settings.set3Current ||
            settings.set3OpenRpm ||
            settings.set3OpenCurrent);
};

MeltemCVSDevice.prototype.setSettings1 = function (settings, resultCB) {
  var self = this;

  self.logTrace('Set Settings 1');
  return new Promise(function(resolve) {
    var date = new Date();
    var payload = 'S60';

    _.each(SETTINGS1_NAME, function(name) {
      payload = payload + valueToString(self.settings[name], settings[name]);
    });

    self.fastMessage([{
        type: 'cmd',
        msgId : date.getMilliseconds(),
        name: 'S60',
        payload: payload,
        timeoutCB : function() {
          var result = { reuslt: 'failed', settings: 'timeout'};

          self.logTrace('Setting failed');
          resolve('timeout');
          resultCB(JSON.stringify(result), undefined);
        }
      },
      {
        type: 'done',
        cb: function () {
          var result = { reuslt: 'success'};

          self.logTrace('Settings successfully done');
          resolve('done');
          resultCB(undefined, JSON.stringify(result));
        }
      }
    ]);
  });
};

MeltemCVSDevice.prototype.setSettings2 = function (settings, resultCB) {
  var self = this;

  self.logTrace('Set Settings 2');
  return new Promise(function(resolve) {
    var date = new Date();
    var payload = 'S61';

    _.each(SETTINGS2_NAME, function(name) {
      payload = payload + valueToString(self.settings[name], settings[name]);
    });

    self.fastMessage([{
        type: 'cmd',
        msgId : date.getMilliseconds(),
        name: 'S61',
        payload: payload,
        timeoutCB : function() {
          var result = { reuslt: 'failed', settings: 'timeout'};

          self.logTrace('Setting failed');
          resolve('timeout');
          resultCB(JSON.stringify(result), undefined);
        }
      },
      {
        type: 'done',
        cb: function () {
          var result = { reuslt: 'success'};

          self.logTrace('Settings successfully done');
          resolve('done');
          resultCB(undefined, JSON.stringify(result));
        }
      }
    ]);
  });
};

MeltemCVSDevice.prototype.setSettingsTest = function (settings, resultCB) {
  var self = this;

  self.logTrace('Set Test Settings');
  return new Promise(function(resolve) {
    var date = new Date();
    var payload = 'S70';

    _.each(SETTINGS3_NAME, function(name) {
      payload = payload + valueToString(self.settings[name], settings[name]);
    });

    self.fastMessage([{
        type: 'cmd',
        msgId : date.getMilliseconds(),
        name: 'S70',
        payload: payload,
        timeoutCB : function() {
          var result = { reuslt: 'failed', settings: 'timeout'};

          self.logTrace('Setting failed');
          resolve('timeout');
          resultCB(JSON.stringify(result), undefined);
        }
      },
      {
        type: 'done',
        cb: function () {
          var result = { reuslt: 'success'};

          self.logTrace('Settings successfully done');
          resolve('done');
          resultCB(undefined, JSON.stringify(result));
        }
      }
    ]);
  });
};

MeltemCVSDevice.prototype.setSettings = function (settings, resultCB) {
  var self = this;

  self.logTrace('Set Settings 1');
  if (self.isSettings1(settings) || self.isSettings2(settings) || self.isSettingsTest(settings)){
    return new Promise(function(resolve) {
      var payload;
      var messages = [];
      var date = new Date();
  
      if (self.isSettings1(settings)){
        payload = 'S60';
        _.each(SETTINGS1_NAME, function(name){
          payload = payload + valueToString(self.settings[name], settings[name]);
        });
  
        messages.push({
          type: 'cmd',
          msgId : date.getMilliseconds(),
          name: 'S60',
          payload: payload,
          timeoutCB : function() {
            var result = { reuslt: 'failed', settings: 'timeout'};
  
            self.logTrace('Setting failed');
            resolve('timeout');
            resultCB(JSON.stringify(result), undefined);
          }
        });
      }
  
      if (self.isSettings2(settings)){
        payload = 'S61';
        _.each(SETTINGS2_NAME, function(name){
          payload = payload + valueToString(self.settings[name], settings[name]);
        });
  
        messages.push({
          type: 'cmd',
          msgId : date.getMilliseconds(),
          name: 'S61',
          payload: payload,
          timeoutCB : function() {
            var result = { reuslt: 'failed', settings: 'timeout'};
  
            self.logTrace('Setting failed');
            resolve('timeout');
            resultCB(JSON.stringify(result), undefined);
          }
        });
      }
      
      if (self.isSettingsTest(settings)) {
        payload = 'S70';
        _.each(SETTINGS3_NAME, function(name){
          payload = payload + valueToString(self.settings[name], settings[name]);
        });
  
        messages.push({
          type: 'cmd',
          msgId : date.getMilliseconds(),
          name: 'S70',
          payload: payload,
          timeoutCB : function() {
            var result = { reuslt: 'failed', settings: 'timeout'};
  
            self.logTrace('Setting failed');
            resolve('timeout');
            resultCB(JSON.stringify(result), undefined);
          }
        });
      }
  
      messages.push({
        type: 'done',
        cb: function () {
          var result = { reuslt: 'success'};

          self.logTrace('Settings successfully done');
          resolve('done');
          resultCB(undefined, JSON.stringify(result));
        }
      });

      self.fastMessage(messages);
    });
  }

  return undefined;
};

MeltemCVSDevice.prototype.getSettings = function() {
  var self = this;

  return  _.cloneDeep(self.settings);
};


MeltemCVSDevice.prototype.setValue = function(field, value) {
  var self = this;

  if (value  && self.settings[field] && (self.settings[field].min <= value) && (value <= self.settings[field].max))
  {
    self.settings[field].value = value;

    return  true;
  }

  return  false;
};

MeltemCVSDevice.prototype.postMessage = function(messages) {
  var self = this;

  try {
    if (!_.isArray(messages)) {
      throw new Error('Messages is not array');
    }

     self.messagePool.queue = self.messagePool.queue.concat(messages);
  }
  catch(e) {
    self.logError(e);
  }
};

MeltemCVSDevice.prototype.fastMessage = function(messages) {
  var self = this;

  try {
    if (!_.isArray(messages)) {
      throw new Error('Messages is not array');
    }

    _.each(messages, function(message) {
      message.fast = true;
      self.messagePool.fastQueue.push(message);
    });
  }
  catch(e) {
    self.logError(e);
  }
};

function CreateInstance(master, id) {
   var  instance;

   instance = new MeltemCVSDevice(master, id);

   return instance;
 }

module.exports = {
   create: CreateInstance
 }; 