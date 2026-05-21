(function() {
  window.createH265webDemoPlayer = function(shared) {
    var h265PlayerHost = shared.elements.h265PlayerHost;
    var overlayProxy = shared.elements.overlayProxy;
    var player = null;
    var currentUrl = '';
    var h265State = {
      currentTimeSec: 0,
      paused: true,
      videoWidth: 1920,
      videoHeight: 1080
    };

    Object.defineProperties(overlayProxy, {
      currentTime: {
        configurable: true,
        get: function() {
          return h265State.currentTimeSec;
        }
      },
      paused: {
        configurable: true,
        get: function() {
          return h265State.paused;
        }
      },
      videoWidth: {
        configurable: true,
        get: function() {
          return h265State.videoWidth;
        }
      },
      videoHeight: {
        configurable: true,
        get: function() {
          return h265State.videoHeight;
        }
      }
    });

    shared.setOverlayMedia(overlayProxy);

    function getSelectedCore() {
      var playerType = shared.playerType || shared.elements.playerType.value;
      if (playerType === 'h265web_mse_hevc') {
        return 'mse_hevc';
      }
      if (playerType === 'h265web_wasm_hevc') {
        return 'wasm_hevc';
      }
      return 'webcodec_hevc';
    }

    function dispatchProxyEvent(type) {
      overlayProxy.dispatchEvent(new Event(type));
    }

    function adaptH265SeiPayload(rawSei, pts) {
      if (!rawSei || typeof rawSei !== 'object') {
        return null;
      }

      if ('uuid' in rawSei && 'user_data' in rawSei) {
        return {
          uuid: rawSei.uuid,
          user_data: rawSei.user_data,
          pts: pts
        };
      }

      return null;
    }

    function resetH265State() {
      h265State.currentTimeSec = 0;
      h265State.paused = true;
      h265State.videoWidth = 1920;
      h265State.videoHeight = 1080;
      dispatchProxyEvent('pause');
    }

    function destroyPlayer() {
      if (!player) {
        return;
      }

      player.release();
      player = null;
      h265PlayerHost.innerHTML = '';
      resetH265State();
    }

    function wireCallbacks(instance) {
      instance.video_probe_callback = function(mediaInfo) {
        var width = Number(mediaInfo && (mediaInfo.width || mediaInfo.w));
        var height = Number(mediaInfo && (mediaInfo.height || mediaInfo.h));

        if (Number.isFinite(width) && width > 0) {
          h265State.videoWidth = width;
        }
        if (Number.isFinite(height) && height > 0) {
          h265State.videoHeight = height;
        }

        dispatchProxyEvent('loadedmetadata');
        console.log('h265web.js media info:', mediaInfo);
      };

      instance.on_ready_show_done_callback = function() {
        dispatchProxyEvent('loadedmetadata');
      };

      instance.video_frame_callback = function(pts, width, height) {
        if (Number.isFinite(Number(width)) && Number(width) > 0) {
          h265State.videoWidth = Number(width);
        }
        if (Number.isFinite(Number(height)) && Number(height) > 0) {
          h265State.videoHeight = Number(height);
        }
      };

      instance.video_sei_raw_callback = function(rawSei, pts) {
        var payload = adaptH265SeiPayload(rawSei, pts);
        if (payload) {
          shared.overlay.pushData(payload);
        }
      };

      instance.on_play_time = function(ptsSec) {
        h265State.currentTimeSec = Number(ptsSec) || 0;
      };

      instance.on_play_finished = function() {
        h265State.paused = true;
        dispatchProxyEvent('pause');
        shared.updatePlayPauseLabel(true);
      };

      instance.on_seek_start_callback = function() {
        dispatchProxyEvent('seeking');
      };

      instance.on_seek_done_callback = function() {
        h265State.paused = false;
        dispatchProxyEvent('play');
      };

      instance.on_error_callback = function(errorPayload) {
        console.error('h265web.js player error:', errorPayload);
      };
    }

    function createPlayer(url) {
      resetH265State();
      h265PlayerHost.innerHTML = '';

      player = H265webjsPlayer();
      wireCallbacks(player);

      var core = getSelectedCore();
      var buildRet = player.build({
        player_id: 'h265PlayerHost',
        base_url: './h265web.js/',
        wasm_js_uri: 'h265web_wasm.js',
        wasm_wasm_uri: 'h265web_wasm.wasm',
        ext_src_js_uri: 'extjs.js',
        ext_wasm_js_uri: 'extwasm.js',
        width: '100%',
        height: '100%',
        color: 'black',
        core: core,
        auto_play: true,
        readframe_multi_times: -1,
        ignore_audio: false
      });

      if (!buildRet) {
        player = null;
        alert('h265web.js build 失败');
        return false;
      }

      if (typeof player.notify_user_gesture === 'function') {
        player.notify_user_gesture();
      }

      player.load_media(url);
      currentUrl = url;
      return true;
    }

    async function startPlayer() {
      var url = shared.elements.streamUrl.value.trim();
      if (!url) {
        alert('请输入流地址');
        return;
      }

      try {
        await shared.ensureScript('h265web-lib', './h265web.js/h265web.js');
      } catch (error) {
        console.error(error);
        alert('h265web.js 加载失败');
        return;
      }

      if (typeof H265webjsPlayer === 'undefined') {
        alert('h265web.js 未加载');
        return;
      }

      if (!player || currentUrl !== url) {
        destroyPlayer();
        shared.resetOverlayData();
        if (!createPlayer(url)) {
          return;
        }
      } else {
        if (typeof player.notify_user_gesture === 'function') {
          player.notify_user_gesture();
        }
        player.play();
      }

      h265State.paused = false;
      dispatchProxyEvent('play');
      shared.overlay.show();
      shared.updatePlayPauseLabel(false);
    }

    function pausePlayer() {
      if (!player) {
        return;
      }

      player.pause();
      h265State.paused = true;
      dispatchProxyEvent('pause');
      shared.updatePlayPauseLabel(true);
    }

    function stopPlayer() {
      destroyPlayer();
      shared.resetOverlayData();
      currentUrl = '';
      shared.updatePlayPauseLabel(true);
    }

    return {
      togglePlayPause: function() {
        if (!player || h265State.paused) {
          startPlayer();
        } else {
          pausePlayer();
        }
      },
      stop: stopPlayer,
      destroy: function() {
        destroyPlayer();
        currentUrl = '';
        shared.updatePlayPauseLabel(true);
      }
    };
  };
})();
