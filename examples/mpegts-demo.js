(function() {
  window.createMpegtsDemoPlayer = function(shared) {
    var videoElement = shared.elements.videoElement;
    var player = null;
    var currentUrl = '';
    var currentOptionsKey = '';

    shared.setOverlayMedia(videoElement);

    function destroyPlayer() {
      if (!player) {
        return;
      }

      player.destroy();
      player = null;
    }

    function getMpegtsOptions() {
      if (typeof shared.getMpegtsOptions === 'function') {
        return shared.getMpegtsOptions();
      }

      return {
        enableWorker: false,
        isLive: false,
        liveBufferLatencyChasing: true
      };
    }

    function normalizeMpegtsOptions(options) {
      return {
        enableWorker: !!options.enableWorker,
        isLive: !!options.isLive,
        liveBufferLatencyChasing: !!options.liveBufferLatencyChasing
      };
    }

    function getOptionsKey(options) {
      return JSON.stringify(options);
    }

    function createPlayer(url, options) {
      player = mpegts.createPlayer({
        type: 'mse',
        isLive: options.isLive,
        url: url
      }, {
        enableWorker: options.enableWorker,
        lazyLoadMaxDuration: 3 * 60,
        seekType: 'range',
        liveBufferLatencyChasing: options.liveBufferLatencyChasing,
        liveSync: false,
        liveBufferLatencyMaxLatency: 1.5,
        liveBufferLatencyMinRemain: 0.5
      });

      player.attachMediaElement(videoElement);

      player.on(mpegts.Events.ERROR, function(errorType, errorDetail, errorInfo) {
        console.error('mpegts.js player error:', errorType, errorDetail, errorInfo);
      });

      player.on(mpegts.Events.MEDIA_INFO, function(mediaInfo) {
        console.log('mpegts.js media info:', mediaInfo);
      });

      player.on(mpegts.Events.SEI_ARRIVED, function(data) {
        console.log('mpegts.js SEI arrived');
        shared.overlay.pushData(data);
      });

      player.load();
      currentUrl = url;
      currentOptionsKey = getOptionsKey(options);
    }

    async function startPlayer() {
      var url = shared.elements.streamUrl.value.trim();
      var options = normalizeMpegtsOptions(getMpegtsOptions());
      var optionsKey = getOptionsKey(options);
      if (!url) {
        alert('请输入流地址');
        return;
      }

      try {
        await shared.ensureScript('mpegts-lib', './mpegts.js/mpegts.js');
      } catch (error) {
        console.error(error);
        alert('mpegts.js 加载失败');
        return;
      }

      if (!mpegts.getFeatureList().mseLivePlayback) {
        alert('当前浏览器不支持 MSE Live Playback');
        return;
      }

      if (!player || currentUrl !== url || currentOptionsKey !== optionsKey) {
        destroyPlayer();
        shared.resetOverlayData();
        createPlayer(url, options);
      }

      player.play();
      shared.overlay.show();
      shared.updatePlayPauseLabel(false);
    }

    function pausePlayer() {
      if (!player) {
        return;
      }

      player.pause();
      shared.updatePlayPauseLabel(true);
    }

    function stopPlayer() {
      destroyPlayer();
      shared.resetOverlayData();
      currentUrl = '';
      currentOptionsKey = '';
      shared.updatePlayPauseLabel(true);
    }

    videoElement.addEventListener('play', function() {
      shared.updatePlayPauseLabel(false);
    });

    videoElement.addEventListener('pause', function() {
      shared.updatePlayPauseLabel(true);
    });

    return {
      togglePlayPause: function() {
        if (!player) {
          startPlayer();
          return;
        }

        if (videoElement.paused) {
          player.play();
          shared.updatePlayPauseLabel(false);
        } else {
          pausePlayer();
        }
      },
      stop: stopPlayer,
      destroy: function() {
        destroyPlayer();
        currentUrl = '';
        currentOptionsKey = '';
        shared.updatePlayPauseLabel(true);
      }
    };
  };
})();
