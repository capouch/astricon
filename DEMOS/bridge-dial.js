/*jshint node:true*/
'use strict';

var ari = require('ari-client');
var util = require('util');

// ensure endpoint was passed in to script
if (!process.argv[2]) {
  console.error('usage: node bridge-dial.js endpoint');
  process.exit(1);
}

ari.connect('http://knuckle.palaver.net:8088', 'brianc', 'getmeoutofhere')
.then(
  // handler for client being loaded
  function (client) {

    // handler for StasisStart event
    function stasisStart(event, channel) {
      // ensure the channel is not a dialed channel
      var dialed = event.args[0] === 'dialed';

      // Ignore this callback if spawned by the dialed channel
      if (!dialed) {
        // Pick up originating channel
        channel.answer(function(err) {
          if (err) {
            throw err;
          }

          console.log('Channel %s has entered our application', channel.name);

          // Let originating calling know what's happening
          var playback = client.Playback();
          channel.play({media: 'sound:pls-hold-while-try'},
            playback, function(err, playback) {
              if (err) {
                throw err;
              }
          });
          // Call endpoint passed as argument
          originate(channel);
        });
      }
    }

    // Bridge originating channel to channel given as argument
    function originate(channel) {
      // Create a new channel for destination
      var dialed = client.Channel();

      // Listen for hangup by dialed extension
      channel.on('StasisEnd', function(event, channel) {
        hangupDialed(channel, dialed);
      });

      // This callback will follow the one above
      dialed.on('ChannelDestroyed', function(event, dialed) {
        hangupOriginal(channel, dialed);
      });

      // Once Stasis has been entered, create a new bridge
      dialed.on('StasisStart', function(event, dialed) {
        joinMixingBridge(channel, dialed);
      });

      // 
      dialed.originate(
        {endpoint: process.argv[2], app: 'bridge-dial', appArgs: 'dialed'},
        function(err, dialed) {
          if (err) {
            throw err;
          }
      });
    }

    // handler for original channel hanging up so we can gracefully hangup the
    // other end
    function hangupDialed(channel, dialed) {
      console.log(
        'Channel %s left our application, hanging up dialed channel %s',
        channel.name, dialed.name);

      // hangup the other end
      dialed.hangup(function(err) {
        // ignore error since dialed channel could have hung up, causing the
        // original channel to exit Stasis
      });
    }

    // handler for the dialed channel hanging up so we can gracefully hangup the
    // other end
    function hangupOriginal(channel, dialed) {
      console.log('Dialed channel %s has been hung up, hanging up channel %s',
        dialed.name, channel.name);

      // hang up the other end
      channel.hangup(function(err) {
        // ignore error since original channel could have hung up, causing the
        // dialed channel to exit Stasis
      });
    }

    // handler for dialed channel entering Stasis
    function joinMixingBridge(channel, dialed) {
      var bridge = client.Bridge();

      dialed.on('StasisEnd', function(event, dialed) {
        dialedExit(dialed, bridge);
      });

      dialed.answer(function(err) {
        if (err) {
          throw err;
        }
      });

      bridge.create({type: 'mixing'}, function(err, bridge) {
        if (err) {
          throw err;
        }

        console.log('Created bridge %s', bridge.id);

        addChannelsToBridge(channel, dialed, bridge);
      });
    }

    // handler for the dialed channel leaving Stasis
    function dialedExit(dialed, bridge) {
      console.log(
          'Dialed channel %s has left our application, destroying bridge %s',
          dialed.name, bridge.id);

      bridge.destroy(function(err) {
        if (err) {
          throw err;
        }
      });
    }

    // handler for new mixing bridge ready for channels to be added to it
    function addChannelsToBridge(channel, dialed, bridge) {
      console.log('Adding channel %s and dialed channel %s to bridge %s',
          channel.name, dialed.name, bridge.id);

      bridge.addChannel({channel: [channel.id, dialed.id]}, function(err) {
        if (err) {
          throw err;
        }
      });
    }

    client.on('StasisStart', stasisStart);

    client.start('bridge-dial');
  })
.catch(function(err) {
  throw err
})
