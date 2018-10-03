mergeInto(LibraryManager.library, {

webxr_init: function(frameCallback, startSessionCallback, endSessionCallback, errorCallback, userData) {
    var coordinateSystem = null;

    function onError(errorCode) {
        if(!errorCallback) return;
        dynCall('vii', errorCallback, [userData, errorCode]);
    };

    function onSessionEnd() {
        if(!endSessionCallback) return;
        dynCall('vi', endSessionCallback, [userData]);
    };

    function onSessionStart() {
        if(!startSessionCallback) return;
        dynCall('vi', startSessionCallback, [userData]);
    };

    function onFrame(time, frame) {
        if(!frameCallback) return;
        var session = frame.session;

        /* Request next frame */
        session.requestAnimationFrame(onFrame);

        var pose = frame.getDevicePose(coordinateSystem);
        if(!pose) return;

        var SIZE_OF_WEBXR_VIEW = (16 + 16 + 4)*4;
        var views = Module._malloc(SIZE_OF_WEBXR_VIEW*2 + 16*4);

        frame.views.forEach(function(view) {
            var viewport = frame.session.baseLayer.getViewport(view);
            var viewMatrix = pose.getViewMatrix(view);
            var offset = views + SIZE_OF_WEBXR_VIEW*(view.eye == 'left' ? 0 : 1);

            // viewMatrix
            for (var i = 0; i < 16; ++i) {
                setValue(offset + i*4, viewMatrix[i], 'float');
            }
            offset += 16*4;

            // projectionMatrix
            for (var i = 0; i < 16; ++i) {
                setValue(offset + i*4, view.projectionMatrix[i], 'float');
            }
            offset += 16*4;

            // viewport
            setValue(offset + 0, viewport.x, 'i32');
            setValue(offset + 4, viewport.y, 'i32');
            setValue(offset + 8, viewport.width, 'i32');
            setValue(offset + 12, viewport.height, 'i32');
        });

        /* Model matrix */
        var modelMatrix = views + SIZE_OF_WEBXR_VIEW*2;
        for (var i = 0; i < 16; ++i) {
            setValue(modelMatrix + i*4, pose.poseModelMatrix[i], 'float');
        }

        Module.ctx.bindFramebuffer(Module.ctx.FRAMEBUFFER,
            session.baseLayer.framebuffer);
        /* HACK: This is not generally necessary, but chrome seems to detect whether the
         * page is sending frames by waiting for depth buffer clear or something */
        Module.ctx.clear(Module.ctx.DEPTH_BUFFER_BIT);

        dynCall('viiii', frameCallback, [userData, time, modelMatrix, views]);
        _free(views);
    };

    function onSessionStarted(session) {
        Module['webxr_session'] = session;

        // Change button on session end
        session.addEventListener('end', function() {
            var label = document.getElementById("vr-button-label");
            label.innerHTML = "Enter VR";

            Module['webxr_session'] = null;
            onSessionEnd();
        });

        // Give application a chance to react to session starting
        // e.g. finish current desktop frame.
        onSessionStart();

        // Set the compatible XR device for existing GL context
        Module.ctx.setCompatibleXRDevice(session.device).then(function() {
            session.baseLayer = new XRWebGLLayer(session, Module.ctx);

            // Get a frame of reference, which is required for querying poses. In
            // this case an 'eye-level' frame of reference means that all poses will
            // be relative to the location where the XRDevice was first detected.
            session.requestFrameOfReference('eye-level').then(function(frameOfRef) {
                coordinateSystem = frameOfRef;
                // Inform the session that we're ready to begin drawing.
                session.requestAnimationFrame(onFrame);
            });
        });
    };

    var polyfill = new WebXRPolyfill();
    var versionShim = new WebXRVersionShim();

    if(navigator.xr) {
        // Request an XRDevice connected to the system.
        navigator.xr.requestDevice().then(function(device) {
            device.supportsSession({immersive: true}).then(function() {
                var label = document.getElementById("vr-button-label");
                if(label) {
                    label.innerHTML = "Enter VR";

                    // User gesture to be allowed to request the session
                    document.getElementById("vr-button").addEventListener('click', function() {
                        var label = document.getElementById("vr-button-label");
                        if(label.innerHTML == "Enter VR") {
                            label.innerHTML = "Exit VR";
                            device.requestSession({immersive: true}).then(onSessionStarted);
                        } else {
                            if(Module['webxr_session']) {
                                Module['webxr_session'].end();
                            }
                        }
                    });
                } else {
                    /* Any click will request VR display */
                    document.addEventListener('click', function() {
                        device.requestSession({immersive: true}).then(onSessionStarted);
                    });
                }

                /* Automatically activate when display activates */
                window.addEventListener('vrdisplayactivate', function() {
                    device.requestSession({immersive: true}).then(onSessionStarted);
                });

            });
        }, function() {
            var label = document.getElementById("vr-button-label");
            label.innerHTML = "(No VR Device)";
        });
    } else {
        /* Call error callback with "WebXR not supported" */
        onError(-2);
    }
},

webxr_request_exit: function() {
    if(Module['webxr_session']) {
        Module['webxr_session'].end();
    }
},

});

