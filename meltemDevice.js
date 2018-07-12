'use strict';

var CONFIG = require('config');
var util = require('util');
var _ = require('lodash');
var EventEmitter = require('events').EventEmitter;
var logger = require('./index').Sensor.getLogger('Sensor');

var STEP_TABLE = [
  { 'name' : 'R1', 'step' : 1},
  { 'name' : 'R2', 'step' : 2},
  { 'name' : 'R3', 'step' : 3},
  { 'name' : 'S1', 'step' : 4},
  { 'name' : 'T1', 'step' : 4},
  { 'name' : 'T2', 'step' : 4},
  { 'name' : 'T3', 'step' : 4},
  { 'name' : 'F1', 'step' : 4}
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

  if (value === undefined) {
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
  self.connectionTimeout = 1800000;
  self.requestPool = {
    fastQueue: [],
    queue: []
  };
  self.group = [{
      initialized: false ,
      fields: [ 's01', 's02', 's03', 's04', 's05', 's06', 's07', 's08', 's09', 's10', 's11', 's12' ] 
    },{
      initialized: false,
      fields: [ 's13', 's14', 's15', 's16', 's17', 's18', 's19', 's20', 's21', 's22', 's23', 's24' ]
    },{
      initialized: false,
      fields: [ 'set1Rpm', 'set1Current', 'set2Rpm', 'set2Current', 'set3Rpm', 'set3Current', 'set3OpenRpm', 'set3OpenCurrent']
    }
  ];

  self.statistics = {
    update: {
      last: false,
      total: 0,
      failure: 0
    },
    responseTime: {
      min: 0,
      max: 0,
      total: 0,
      count: 0,
      average: 0
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

  self.responseProcess = {
    D00 : function(data) {
      try {
        if (!_.isString(data) || data.length !== 34) {
          throw new Error('Invalid Data : ' + data);
        }

        var stepObject = _.find(STEP_TABLE, { 'name' : data.substr(22, 2)});
        if (!stepObject) {
          throw new Error('Invalid Step : ' + data.substr(22, 2));
        }

        var pressure = parseInt(data.substr(10, 4));
        var rpm = parseInt(data.substr(14, 4));
        var current = parseInt(data.substr(18, 4));
        var power = current*440/1000;
        var temperature = parseInt(data.substr(24, 4));
        var operatingTime = parseInt(data.substr(28, 5));

        var date = new Date();
        self.master.emit(self.id + '-mode', { value: stepObject.step, time:  date.getTime() });
        self.master.emit(self.id + '-pressure', { value: pressure, time: date.getTime() });
        self.master.emit(self.id + '-rpm', { value: rpm, time: date.getTime() });
        self.master.emit(self.id + '-current', { value: current, time: date.getTime() });
        self.master.emit(self.id + '-power', { value: power, time: date.getTime() });
        self.master.emit(self.id + '-temperature', { value: temperature, time: date.getTime() });
        self.master.emit(self.id + '-operating_time', { value: operatingTime, time: date.getTime() });

        return  'done';
      }
      catch(e) {
        self.logError(e);
        return  'error';
      }
    },
    D60: function(data) {
      try {
        if (!_.isString(data) || data.length !== 59) {
          throw new Error('Invalid Data : ' + _.isString(data) + ',' + data.length);
        }

        _.each(self.group[0].fields, function(name, i) {
          self.settings[name].value  = parseInt(data.substr(10 + i * 4, 4));
        });

        self.group[0].initialized = true;
        return  'done';
      }
      catch(e) {
        self.logError(e);
        return  'error';
      }
    },
    D61: function(data) {
      try {
        if (!_.isString(data) || data.length !== 59) {
          throw new Error('Invalid Data : ' + data);
        } 
      
        _.each(self.group[1].fields, function(name, i) {
            self.settings[name].value = parseInt(data.substr(10 + i * 4, 4));
        });

        self.group[1].initialized = true;
        return  'done';
      }
      catch(e) {
        self.logError(e);
        return  'error';
      }
    },
    D70: function(data) {
      try {
        if (!_.isString(data) || data.length !== 43) {
          throw new Error('Invalid Data : ' + data);
        }
      
        _.each(self.group[2].fields, function(name, i) {
          self.settings[name].value = parseInt(data.substr(10 + i * 4, 4));
        });

        self.group[2].initialized = true;
        return  'done';
      }
      catch(e) {
        self.logError(e);
        return  'error';
      }
    },
    S60: function(data) {
      self.logTrace('Set setting part 1.');

      try {
        if (!_.isString(data) || data.length !== 59) {
          throw new Error('Invalid Data : ' + data);
        }

        _.each(self.group[0].fields, function(name, i) {
          self.settings[name].value = parseInt(data.substr(10 + i * 4, 4));
        });

        self.group[0].initialized = true;
        return  'done';
      }
      catch(e) {
        self.logError(e);
        return  'error';
      }
    },
    S61: function(data) {
      self.logTrace('Set setting part 2.');

      try {
        if (!_.isString(data) || data.length !== 59) {
          throw new Error('Invalid Data : ' + data);
        }
    
        _.each(self.group[1].fields, function(name, i) {
          self.settings[name].value = parseInt(data.substr(10 + i * 4, 4));
        });

        self.group[1].initialized = true;
        return  'done';
      }
      catch(e) {
        self.logError(e);
        return  'error';
      }
    },
    S70: function(data) {
      self.logTrace('View test setting.');
      
      try {
        if (!_.isString(data) || data.length !== 43) {
          throw new Error('Invalid Data : ' + data);
        }

        _.each(self.group[2].fields, function(name, i) {
          self.settings[name].value = parseInt(data.substr(10 + i * 4, 4));
        });

        self.group[2].initialized = true;
        return  'done';
      }
      catch(e) {
        self.logError(e);
        return  'error';
      } 
    },
    P00: function(data) {
      self.logTrace('Save Settings & Restart.');
      
      try {
        if (!_.isString(data) || data.length !== 11) {
          throw new Error('Invalid Data : ' + data);
        }
        return  'done';
      }
      catch(e) {
        self.logError(e);
        return  'error';
      } 
    },
    R00: function(data) {
      self.logTrace('Restart.');
      
      try {
        if (!_.isString(data) || data.length !== 11) {
          throw new Error('Invalid Data : ' + data);
        }
        return  'done';
      }
      catch(e) {
        self.logError(e);
        return  'error';
      } 
    }
  };

  EventEmitter.call(self);

  self.on('data', function(data) {
    try{
      self.logTrace(data);

      if ((!self.requestPool.current) || (data.length < 11)) {
        throw new Error('Invalid Data');
      }
 
      var response = self.responseProcess[data.substr(7, 3)];
      if (response) {
        throw new Error('Invalid command');
      }

      self.updateRequestStatistics(response(self.requestPool.current, data));
      self.master.doneMessage(self.requestPool.current.seq);

      self.requestPool.current = undefined;
      self.statistics.request.succss = self.statistics.request.success + 1;
    }
    catch(e) {
      self.logError(e);
    }
  });

  self.on('control', function(params, cb){
    var result = {};

    try {
      result.cmd = params.cmd;

      self.logTrace('Device Control :', params);
      if (params.cmd === 'set') {
        if (!self.initialized) {
          throw new Error('The device is not initialized.');
        }

        if (!params.settings) {
          throw new Error('The parameter is incorrect.');
        }

        self.setSettings(params.settings).then(function(message) {
          if (message === 'done') {
            result.settings = {};

            _.each(params.settings, function(value , key) {
              if (self.settings[key]) {
                result.settings[key] = { value: self.settings[key].value, min: self.settings[key].min, max: self.settings[key].max };
              }
            });

            self.logTrace('Settings successfully done');
            return  cb && cb(undefined, JSON.stringify(result));
          }
          else {
            result.result = 'failed';
            result.message = message;
  
            self.logTrace('Setting failed');
            return  cb && cb(JSON.stringify(result), undefined);
         }
        });
      }
      else if (params.cmd === 'get') {
        self.getSettings().then(function(init) {
          if (init === 'done')  {
            var settings = {};
            _.each(self.settings, function(setting, key) {
              settings[key] = { value: setting.value, min: setting.min, max: setting.max };
            });
      
            result.settings = settings;
      
            return cb && cb(undefined, JSON.stringify(result));
          }
          else {
            result.result = 'failed';
            result.message = init;
      
            if (cb) {
              cb(undefined, JSON.stringify(result));
            }
          }
        });
      }
      else if (params.cmd === 'ctrl') {
        if (params.requestTimeout) {
          if (1000 > params.requestTimeout) {
            throw new Error('Request timeout is too short( > 1000 ms).');
          }

          self.requestTimeout = params.requestTimeout;
          result.requestTimeout = self.requestTimeout;
          result.result = 'success';
        }

        if (params.connectionTimeout) {
          if (self.requestTiemout * 2 > params.connectionTimeout) {
            throw new Error('Timeout is too short.');
          }

          self.connectionTimeout = params.connectionTimeout;
          result.connectionTimeout= self.connectionTimeout;
          result.result = 'success';
        }

        if (result.result === undefined) {
          throw new Error('Invalid parameter.');
        }

        return cb && cb(JSON.stringify(result));
      }
      else if (params.cmd === 'reset') {
        self.factoryReset(cb);
      }
      else {
        throw new Error('This command is not supported.');
      }
    }
    catch(e) {
      result.result = 'failed';
      result.message = e.message;
      return cb && cb(JSON.stringify(result));
    }
 });
 
  self.on('waitDone', function(request) {
    try{
      if (!self.requestPool.current) {
        throw new Error('Invalid Data');
      }

      if (self.requestPool.current !== request) {
        throw new Error('Wait mismatch : ' + self.requestPool.current.seq + ' !== ' + request.seq);
      }

      self.master.doneMessage(self.requestPool.current.seq);

      self.requestPool.current = undefined;
      self.statistics.request.succss = self.statistics.request.success + 1;
    }
    catch(e) {
      self.logError(e);
    }
  });

  self.on('timeout', function(request) {
    try {
      if (self.requestPool.current !== request) {
        throw new Error('Occurred timeout but seq mismatch : ' + self.requestPool.current.seq + ' !== ' + request.seq);
      }

      if (self.requestPool.current.timeoutCB) {
        self.requestPool.current.timeoutCB();
      }
      self.timeoutRequest = self.requestPool.current;
      self.requestPool.current = undefined;
    }
    catch(e) {
      self.logError(e);
    }
  });

  self.on('done', function(request) {
    try {
      if (self.requestPool.current !== request) {
        throw new Error('Occurred done but seq mismatch : ' + self.requestPool.current.seq + ' !== ' + request.seq);
      }

      if (self.requestPool.current.successCB) {
        self.requestPool.current.successCB();
      }
      self.requestPool.current = undefined;
    }
    catch(e) {
      self.logError(e);
    }
  });

  setInterval(function() {
    if (!self.requestPool.current) {
      self.requestPool.current = self.requestPool.fastQueue.shift();
      if (self.requestPool.current) {
        self.master.fastRequest(self, self.requestPool.current);
      }
      else {
        self.requestPool.current = self.requestPool.queue.shift();
        if (self.requestPool.current) {
          self.master.sendRequest(self, self.requestPool.current);
        }
      }
    }
  }, 100);
}

util.inherits(MeltemCVSDevice, EventEmitter);

MeltemCVSDevice.prototype.logError = function() {
  var self = this;

  if (self.log.error) {
    var i;
    var message = self.master.getID() + '-' + self.id + ' :';

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

MeltemCVSDevice.prototype.logTrace = function() {
  var self =  this;

  if (self.log.trace) {
    var i;
    var message = self.master.getID() + '-' + self.id + ' :';

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

MeltemCVSDevice.prototype.isInitialized = function() {
  var self = this;

  return  self.initialized;
};

MeltemCVSDevice.prototype.getDefaultSettings = function() {
  var self = this;
  var settings = _.cloneDeep(DEFAULT_SETTINGS);

  try{
    _.each(DEFAULT_SETTINGS, function(setting, name) {
      settings[name] = _.clone(setting);
      if (CONFIG.meltem && CONFIG.meltem.config) {
        if (CONFIG.meltem.config[name]) {
          if (CONFIG.meltem.config[name].min) {
            settings[name].min = CONFIG.meltem.config[name].min;
          }
  
          if (CONFIG.meltem.config[name].max) {
            settings[name].max = CONFIG.meltem.config[name].max;
          }
        }
      }
    });
  }
  catch(e) {
    self.logError(e);
  }

  return  settings;
};

MeltemCVSDevice.prototype.getInitTimeout = function() {
  var self = this;
  var timeout = 0;

  _.each(self.group, function(status) {
    if (!status.initialized) {
      timeout = timeout + self.requestTimeout;
    }
  });

  if (timeout < self.requestTimeout) {
    timeout = self.requestTimeout;
  }

  return  timeout;
};
MeltemCVSDevice.prototype.getConnectionTimeout = function() {
  var self = this;

  return  self.connectionTimeout;
};

MeltemCVSDevice.prototype.getRequestTimeout = function() {
  var   self = this;

  return  self.requestTimeout;
};

MeltemCVSDevice.prototype.didLastUpdateSucceed = function() {
  var self = this;

  return  self.statistics.update.last;
};

MeltemCVSDevice.prototype.init = function () {
  var self = this;

  return new Promise(function(resolve) {
    var messages = [];

    if (!self.group[0].initialized) {
      messages.push({
        type: 'cmd',
        name: 'D60',
        payload: 'D60'
      });
    }

    if (!self.group[1].initialized) {
      messages.push({
        type: 'cmd',
        name: 'D61',
        payload: 'D61'
      });
    }

    if (!self.group[2].initialized) {
      messages.push({
        type: 'cmd',
        name: 'D70',
        payload: 'D70'
      });
    }
  
    self.sendRequest(messages,
      function () {
        self.initialized = true;
        self.logTrace('Device[', self.id, '] Initalized done.');
        resolve('done');
      },
      function() {
        self.logTrace('Device[', self.id, '] initialization failed.');
        resolve('timeout');
      }
    );
  });
};

MeltemCVSDevice.prototype.update = function () {
  var self = this;

  return new Promise(function(resolve) {
    self.statistics.update.total = self.statistics.update.total + 1;

    self.sendRequest([ { type: 'cmd', name: 'D00', payload: 'D00' }],
      function () {
        self.statistics.update.last = true;
        self.logTrace('Device[', self.id, '] state updated');
        resolve('done');
      },
      function() {
        self.statistics.update.last = false;
        self.statistics.update.failure = self.statistics.update.failure + 1;
        var failureRatio = self.statistics.update.failure * 100.0 / self.statistics.update.total;

        var message = 'Device[';
        message = message + self.id;
        message = message + '] state update failed [ ';
        message = message + self.statistics.update.total;
        message = message + ' / ';
        message = message + (self.statistics.update.total - self.statistics.update.failure);
        message = message + ' / ';
        message = message + self.statistics.update.failure;
        message = message + ' / ';
        message = message + failureRatio.toFixed(2);
        message = message + ' % ]';
        self.logTrace(message);

        resolve('timeout');
      }
    );
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

MeltemCVSDevice.prototype.updateRequestStatistics = function(result) {
  var self =this;

  var date = new Date();
  var request = self.requestPool.current;
  var session =request.current;

  if (session) {
    var elapsedTime = date.getTime() - session.requestTime;
    if  (result === 'done') {
      self.statistics.request.success = self.statistics.request.success + 1; 
    }
    else {
      self.statistics.request.failure = self.statistics.request.failure + 1; 
    }
  
    if (!self.statistics.responseTime.min || (self.statistics.responseTime.min > elapsedTime)){
      self.statistics.responseTime.min = elapsedTime;
    }
  
    if (!self.statistics.responseTime.max || (self.statistics.responseTime.max < elapsedTime)){
        self.statistics.responseTime.max = elapsedTime;
    }
  
    self.statistics.responseTime.count = self.statistics.responseTime.count + 1; 
    if (!self.statistics.responseTime.average) {
      self.statistics.responseTime.average = elapsedTime;
      self.statistics.responseTime.total = elapsedTime;
    }
    else {
      self.statistics.responseTime.total = self.statistics.responseTime.total + elapsedTime;
      self.statistics.responseTime.average = (self.statistics.responseTime.total / self.statistics.responseTime.count);
    }
  }
};

MeltemCVSDevice.prototype.responseCB = function(data, delayed) {
  var self = this;
  try{
    self.logTrace(data);

    if (data.length < 11) {
      throw new Error('Invalid Data');
    }
 
    var cmd = data.substr(7, 3);
    var response = self.responseProcess[cmd];
    if (!response) {
      throw new Error('Invalid command[' + cmd + ']');
    }

    if (delayed) {
      self.logTrace('Delayed response accepted');
    }
    self.updateRequestStatistics(response(data, self.requestPool.current));
  }
  catch(e) {
    self.logError(e);

    return  undefined;
  }
  return  'done';
};

MeltemCVSDevice.prototype.isSettings1 = function(settings) {
  var self = this;

  return _.find(self.group[0].fields, function(name){
    return  settings[name] !== undefined;
  }) !== undefined;
};

MeltemCVSDevice.prototype.isSettings2 = function(settings) {
  var self = this;

  return _.find(self.group[1].fields, function(name){
    return  settings[name] !== undefined;
  }) !== undefined;
};

MeltemCVSDevice.prototype.isSettingsTest = function(settings) {
  var self = this;

  return _.find(self.group[2].fields, function(name){
    return  settings[name] !== undefined;
  }) !== undefined;
};

MeltemCVSDevice.prototype.setSettings1 = function (settings, resultCB) {
  var self = this;

  self.logTrace('Set Settings 1');
  return new Promise(function(resolve) {
    var payload = 'S60';

    _.each(self.group[0].fields, function(name) {
      payload = payload + valueToString(self.settings[name], settings[name]);
    });

    self.sendRequest([{ type: 'cmd', name: 'S60', payload: payload }],
      function () {
        var result = { result: 'success'};

        self.logTrace('Settings successfully done');
        resolve('done');
        resultCB(undefined, JSON.stringify(result));
      },
      function() {
        var result = { cmd: 'set', result: 'failed', message: 'timeout'};

        self.logTrace('Setting failed');
        resolve('timeout');
        resultCB(JSON.stringify(result), undefined);
      }
    );
  });
};

MeltemCVSDevice.prototype.setSettings2 = function (settings, resultCB) {
  var self = this;

  self.logTrace('Set Settings 2');
  return new Promise(function(resolve) {
    var payload = 'S61';

    _.each(self.group[1].fields, function(name) {
      payload = payload + valueToString(self.settings[name], settings[name]);
    });

    self.sendRequest([{ type: 'cmd', name: 'S61', payload: payload}],
      function () {
        var result = { result: 'success'};

        self.logTrace('Settings successfully done');
        resolve('done');
        resultCB(undefined, JSON.stringify(result));
      },
      function() {
        var result = { cmd: 'set', result: 'failed', message: 'timeout'};

        self.logTrace('Setting failed');
        resolve('timeout');
        resultCB(JSON.stringify(result), undefined);
      }
    );
  });
};

MeltemCVSDevice.prototype.setSettingsTest = function (settings, resultCB) {
  var self = this;

  self.logTrace('Set Settings Test');
  return new Promise(function(resolve) {
    var payload = 'S70';

    _.each(self.group[2].fields, function(name) {
      payload = payload + valueToString(self.settings[name], settings[name]);
    });

    self.sendRequest([{ type: 'cmd', name: 'S70', payload: payload }],
      function () {
        var result = { result: 'success'};

        self.logTrace('Settings successfully done');
        resolve('done');
        resultCB(undefined, JSON.stringify(result));
      },
      function() {
        var result = { cmd: 'set', result: 'failed', message: 'timeout'};

        self.logTrace('Setting failed');
        resolve('timeout');
        resultCB(JSON.stringify(result), undefined);
      }
    );
  });
};

MeltemCVSDevice.prototype.reset = function (resultCB) {
  var self = this;

  self.logTrace('reset');
  return new Promise(function(resolve) {
    var payload = 'R00';

    self.fastRequest([{
        type: 'cmd',
        name: 'R00',
        payload: payload,
      }, {
        type: 'wait',
        time: 5000
      }],
      function () {
        var result = { result: 'success'};

        self.logTrace('Reset successfully done');
        resolve('done');
        resultCB(undefined, JSON.stringify(result));
      },
      function() {
        var result = { cmd: 'reset', result: 'failed', message: 'timeout'};

        self.logTrace('Reset failed');
        resolve('timeout');
        resultCB(JSON.stringify(result), undefined);
      }
    );
  });
};

MeltemCVSDevice.prototype.setSettings = function (settings) {
  var self = this;

  self.logTrace('setSettings :', JSON.stringify(settings));
  return new Promise(function(resolve) {
    if (self.isSettings1(settings) || self.isSettings2(settings) || self.isSettingsTest(settings)){
      var messages = [];
      var payload;

      if (self.isSettings1(settings)){
        self.logTrace('Set Settings 1');
        payload = 'S60';
        _.each(self.group[0].fields, function(name){
          payload = payload + valueToString(self.settings[name], settings[name]);
        });
 
        messages.push({
          type: 'cmd',
          name: 'S60',
          payload: payload
        });
      }
  
      if (self.isSettings2(settings)){
        self.logTrace('Set Settings 2');
        payload = 'S61';
        _.each(self.group[1].fields, function(name){
          payload = payload + valueToString(self.settings[name], settings[name]);
        });
  
        messages.push({
          type: 'cmd',
          name: 'S61',
          payload: payload
        });
      }
      
      if (self.isSettingsTest(settings)) {
        self.logTrace('Set Settings Test');
        payload = 'S70';
        _.each(self.group[2].fields, function(name){
          payload = payload + valueToString(self.settings[name], settings[name]);
        });
  
        messages.push({
          type: 'cmd',
          name: 'S70',
          payload: payload
        });
      }

      if (messages.length) {
        self.logTrace('Save Settings');
        payload = 'P00';

        messages.push({
          type: 'cmd',
          name: 'P00',
          payload: payload
        });
      }

      self.fastRequest(messages,
        function () {
          resolve('done');
        },
        function() {
          resolve('timeout');
        }
      );
    }
    else {
      resolve('done');
    }
  });
};

MeltemCVSDevice.prototype.getSettings = function() {
  var self = this;

  return  new Promise(function(resolve) {
    var messages = [];
  
    if (!self.group[0].initialized) {
      messages.push({
        type: 'cmd',
        name: 'D60',
        payload: 'D60'
      });
    }
  
    if (!self.group[1].initialized) {
      messages.push({
        type: 'cmd',
        name: 'D61',
        payload: 'D61'
      });
    }
  
    if (!self.group[2].initialized) {
      messages.push({
        type: 'cmd',
        name: 'D70',
        payload: 'D70'
      });
    }
   
    if (messages.length !== 0) {
      self.fastRequest(messages,
        function () {
          self.initialized = true;
          self.logTrace('Device[', self.id, '] Initalized done.');
          resolve('done');
        },
        function() {
          self.logTrace('Device[', self.id, '] initialization failed. Response timed out.');
          resolve('timeout');
        }
      );
    }
    else {
      resolve('done');
    }
  });
};

MeltemCVSDevice.prototype.getStatistics = function() {
  var self = this;

  return  self.statistics;
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

MeltemCVSDevice.prototype.sendRequest = function(messages, successCB, timeoutCB) {
  var self = this;

  try {
    var date = new Date();

    var request = {
      id: date.getTime(),
      messages: messages,
      successCB: successCB,
      timeoutCB: timeoutCB
    };

    request.messages.push({
      type: 'done'
    });

    self.requestPool.queue.push(request);
  }
  catch(e) {
    self.logError(e);
  }
};

MeltemCVSDevice.prototype.fastRequest = function(messages, successCB, timeoutCB) {
  var self = this;

  try {
    var date = new Date();

    var request = {
      id: date.getTime(),
      messages: messages,
      successCB: successCB,
      timeoutCB: timeoutCB
    };

    request.messages.push({
      type: 'done'
    });

  self.logTrace('Fast Request called[', self.requestPool.fastQueue.length, ']');
    self.requestPool.fastQueue.push(request);
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