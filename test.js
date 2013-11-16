var PixelPusher = require('./pixelpusher')
  ;

new PixelPusher().on('discover', function(controller) {
  console.log('discovery: ' + JSON.stringify(controller.params.pixelpusher));

  controller.on('update', function() {
    console.log ({ updatePeriod  : this.params.pixelpusher.updatePeriod
                 , deltaSequence : this.params.pixelpusher.deltaSequence
                 , powerTotal    : this.params.pixelpusher.powerTotal
                 });
  });

  var n = 0;
  setInterval(function() {
    var i, strips, x;

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
  }, 500);
}).on('error', function(err) {
  console.log('oops: ' + err.message);
});
