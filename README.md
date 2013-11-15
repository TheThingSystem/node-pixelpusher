node-pixelpusher
================

A node.js module to interface with [Heroic Robotics'](http://www.heroicrobotics.com) Pixel Pusher LED controller.

Install
-------

    npm install pixelpusher

API
---

### Load

    var PixelPusher = require('pixelpusher');


### Discover

    var pp = new PixelPusher().on('discover', function(controller) {
      // inspect controller.params and controller.params.pixelpusher...

      setInterval(function() { refresh(controller); }, 500);
    }).on('update', function(controller) {
      // inspect controller.params.pixelpusher...
    }).on('error', function(err) {
      console.log('oops: ' + err.message);
    });


### Refresh

    var n = 0;
    var refresh = function(controller) {
      var i, strips, x;
    
      // every 1/4-second change the colors
      strips = [];
      strips[0] = { number: 0, data: new Buffer(3 * controller.params.pixelpusher.pixelsPerStrip) };
      strips[0].data.fill(0x00);
      x = [ [ 0, 4, 8 ], [ 1, 5, 9 ], [ 2, 6, -1] ][n % 3];
      for (i = 0; i < controller.params.pixelpusher.pixelsPerStrip; i += 9) {
        strips[0].data[i + x[0]] = 0xff;
        strips[0].data[i + x[1]] = 0xff;
        strips[0].data[i + x[2]] = 0xff;
      }
       
      controller.refresh(strips);
      n++;
    };
