// pixelpusher.js -- see the include file below courtesy of Jas Strong

var dgram   = require('dgram')
  , Emitter = require('events').EventEmitter
  , util    = require('util')
  ;


var DEFAULT_LOGGER = { error   : function(msg, props) { console.log(msg); if (!!props) console.trace(props.exception); }
                     , warning : function(msg, props) { console.log(msg); if (!!props) console.log(props);             }
                     , notice  : function(msg, props) { console.log(msg); if (!!props) console.log(props);             }
                     , info    : function(msg, props) { console.log(msg); if (!!props) console.log(props);             }
                     , debug   : function(msg, props) { console.log(msg); if (!!props) console.log(props);             }
                     };


var PixelPusher = function(options) {
  var self = this;

  if (!(self instanceof PixelPusher)) return new PixelPusher(options);

  self.options = options;
  self.logger = DEFAULT_LOGGER;
  self.controllers = {};

  dgram.createSocket('udp4').on('message', function(message, rinfo) {
    var controller, cycleTime, delta, mac, params;

    if (message.length < 48) return self.logger.debug('message too short (' + message.length + ' octets)', rinfo);

    mac = message.slice(0, 6).toString('hex').match(/.{2}/g).join(':');
    if (!!self.controllers[mac]) {
      controller = self.controllers[mac];
      if (controller.params.deviceType !== 2) return;

      cycleTime = message.readUInt32LE(28) / 1000;
      delta = message.readUInt32LE(36);
      if (delta > 5) {
        cycleTime += 5; 
        controller.trim(controller);
      } else if ((delta === 0) && (cycleTime > 1)) cycleTime -= 1;
      controller.params.pixelpusher.updatePeriod = cycleTime;
      controller.params.pixelpusher.powerTotal = message.readUInt32LE(32);
      controller.params.pixelpusher.deltaSequence = delta;
      controller.lastUpdated = new Date().getTime();
      controller.nextUpdate = controller.lastUpdated + cycleTime;
      if (!!controller.timer) {
        clearTimeout(controller.timer);
        controller.sync(controller);
      }
      return controller.emit('update');
    }

    params = { macAddress   : mac
             , ipAddress    : message.slice(6, 10).toString('hex').match(/.{2}/g)
                                     .map(function(x) { return parseInt(x, 16); }).join('.')
             , deviceType   : message[10]
             , protocolVrsn : message[11]
             , vendorID     : message.readUInt16LE(12)
             , productID    : message.readUInt16LE(14)
             , hardwareRev  : message.readUInt16LE(16)
             , softwareRev  : message.readUInt16LE(18)
             , linkSpeed    : message.readUInt32LE(20)

             , socket       : this
             };
    if (params.deviceType !== 2) params.payload = message.slice(24).toString('hex');
    else {
      params.pixelpusher = { numberStrips   : message[24]
                           , stripsPerPkt   : message[25]
                           , pixelsPerStrip : message.readUInt16LE(26)
                           , updatePeriod   : message.readUInt32LE(28) / 1000
                           , powerTotal     : message.readUInt32LE(32)
                           , deltaSequence  : message.readUInt32LE(36)
                           , controllerNo   : message.readInt32LE(40)
                           , groupNo        : message.readInt32LE(44)
                           };

      if (message.length >= 54) {
        params.pixelpusher.artnetUniverse   = message.readUInt16LE(48);
        params.pixelpusher.artnetChannel    = message.readUInt16LE(50);
        params.pixelpusher.myPort           = message.readUInt16LE(52);
      }
      else {
        params.pixelpusher.myPort           = 9761;
      }

      if (message.length >= 62) {
        params.pixelpusher.stripFlags       = message.slice(54, 62).toString('hex').match(/.{2}/g)
                                                     .map(function(x) { return parseInt(x, 16); });
      }

      if (message.length >= 66) {
        params.pixelpusher.pusherFlags      =   message.readInt32LE(62);
      }
    }

    self.controllers[mac] = new Controller(params);
    self.emit('discover', self.controllers[mac]);
  }).on('listening', function() {
    self.logger.info('PixelPusher listening on udp://*:' + this.address().port);
  }).on('error', function(err) {
    self.logger.error('PixelPusher error', err);
    self.emit('error', err);
  }).bind(7331);

  setInterval(function() {
    var controller, mac, now;

    now = new Date().getTime();
    for (mac in self.controllers) {
      if (!self.controllers.hasOwnProperty(mac)) continue;
      controller = self.controllers[mac];

      if ((controller.lastUpdated + (5 * 1000)) >= now) continue;

      controller.emit('timeout');
      if (!!controller.timer) clearTimeout(controller.timer);
      delete(self.controllers[mac]);
    }
  }, 1000);
};
util.inherits(PixelPusher, Emitter);

var Controller = function(params) {
  var self = this;

  if (!(self instanceof Controller)) return new Controller(params);

  self.params = params;
  self.logger = DEFAULT_LOGGER;

  self.lastUpdated = new Date().getTime();
  self.nextUpdate = self.lastUpdated + self.params.pixelpusher.updatePeriod;

  self.sequenceNo = 0;
  self.messages = [];
  self.timer = null;
};
util.inherits(Controller, Emitter);

Controller.prototype.refresh = function(strips) {
  var i, m, n, numbers, offset, packet, self;

  self = this;

  packet = null;
  for (i = 0; i < strips.length; ) {
    if (packet === null) {
      n = strips.length - i;
      if (n > self.params.stripsPerPkt) n = self.params.stripsPerPkt;
      offset = 4;
      for (m = 0; m < n; m++) offset += 1 + strips[i + m].data.length;
      packet = new Buffer(offset);
      packet.fill(0x00);

      offset = 0;
      packet.writeUInt32LE(++self.sequenceNo, offset);
      offset += 4;

      numbers = [];
    }
    numbers.push(strips[i].number);
    packet.writeUInt8(strips[i].number, offset++);
    strips[i].data.copy(packet, offset);
    offset += strips[i].data.length;

    if ((++i % self.params.stripsPerPkt) === 0) {
      self.messages.push({ sequenceNo: self.sequenceNo, packet: packet, numbers: numbers });
      packet = null;
    }
  }
  if (!!packet) self.messages.push({ sequenceNo: self.sequenceNo, packet: packet, numbers: numbers });

  if ((self.timer === null) && (self.messages.length > 0)) self.sync(self);
};

Controller.prototype.sync = function(self) {
  var message, now, packet;

  now = new Date().getTime();
  if (now < self.nextUpdate) {
    self.timer = setTimeout(function() { self.sync(self); }, self.nextUpdate - now);
    return;
  }
  self.timer = null;

  message = self.messages.shift();
  packet = message.packet;
  self.params.socket.send(packet, 0, packet.length, self.params.pixelpusher.myPort, self.params.ipAddress);
  self.nextUpdate = now + self.params.pixelpusher.updatePeriod;
  if (self.messages.length === 0) return;

  self.timer = setTimeout(function() { self.sync(self); }, self.params.pixelpusher.updatePeriod);
};

Controller.prototype.trim = function(self) {
  var f, i, j, messages, numbers, x;

  if (self.messages.length < 2) return;

  f = function(j) {
    return function() { return numbers.filter(function(n) { return (self.messages[j].numbers.indexOf(n) !== -1); }); };
  };

  messages = [];
  for (i = 0; i < self.messages.length; i++) {
    numbers = self.messages[i].numbers;
    for (j = i + 1; j < self.messages.length; j++) {
      x = f(j);
      if (x.length > 0) break;
    }
    if (j === self.messages.length) messages.push(self.messages[i]);
  }
  self.messages = messages;
};

module.exports = PixelPusher;

return;

/*
 *  Universal Discovery Protocol
 *  A UDP protocol for finding Etherdream/Heroic Robotics lighting devices
 *
 *  (c) 2012 Jas Strong and Jacob Potter
 *  <jasmine@electronpusher.org> <jacobdp@gmail.com>
 */

/*

#define SFLAG_RGBOW             (1 << 0)
#define SFLAG_WIDEPIXELS        (1 << 1)

#define PFLAG_PROTECTED         (1 << 0)

typedef enum DeviceType { ETHERDREAM = 0, LUMIABRIDGE = 1, PIXELPUSHER = 2 } DeviceType;

typedef struct PixelPusher {
    uint8_t  strips_attached;
    uint8_t  max_strips_per_packet;
    uint16_t pixels_per_strip;          // uint16_t used to make alignment work
    uint32_t update_period;             // in microseconds
    uint32_t power_total;               // in PWM units
    uint32_t delta_sequence;            // difference between received and expected sequence numbers
    int32_t controller_ordinal;         // ordering number for this controller.
    int32_t group_ordinal;              // group number for this controller.
    uint16_t artnet_universe;           // configured artnet starting point for this controller
    uint16_t artnet_channel;
    uint16_t my_port;
    uint8_t strip_flags[8];             // flags for each strip, for up to eight strips
    uint32_t pusher_flags;              // flags for the whole pusher
} PixelPusher;

typedef struct LumiaBridge {
    // placekeeper
} LumiaBridge;

typedef struct EtherDream {
    uint16_t buffer_capacity;
    uint32_t max_point_rate;
    uint8_t light_engine_state;
    uint8_t playback_state;
    uint8_t source;     //   0 = network
    uint16_t light_engine_flags;
    uint16_t playback_flags;
    uint16_t source_flags;
    uint16_t buffer_fullness;
    uint32_t point_rate;                // current point playback rate
    uint32_t point_count;               //  # points played
} EtherDream;

typedef union {
    PixelPusher pixelpusher;
    LumiaBridge lumiabridge;
    EtherDream etherdream;
} Particulars;

typedef struct DiscoveryPacketHeader {
    uint8_t mac_address[6];
    uint8_t ip_address[4];              // network byte order
    uint8_t device_type;
    uint8_t protocol_version;           // for the device, not the discovery
    uint16_t vendor_id;
    uint16_t product_id;
    uint16_t hw_revision;
    uint16_t sw_revision;
    uint32_t link_speed;                // in bits per second
} DiscoveryPacketHeader;

typedef struct DiscoveryPacket {
    DiscoveryPacketHeader header;
    Particulars p;
} DiscoveryPacket;

*/
