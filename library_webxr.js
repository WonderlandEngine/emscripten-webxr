var LibraryWebXR = {

$WebXR: {
    _coordinateSystem: null,

    _nativize_vec3: function(offset, vec) {
        setValue(offset + 0, vec[0], 'float');
        setValue(offset + 4, vec[1], 'float');
        setValue(offset + 8, vec[2], 'float');

        return offset + 12;
    },

    _nativize_matrix: function(offset, mat) {
        for (var i = 0; i < 16; ++i) {
            setValue(offset + i*4, mat[i], 'float');
        }

        return offset + 16*4;
    },
    /* Sets input source values to offset and returns pointer after struct */
    _nativize_input_source: function(offset, inputSource) {
        var handedness = -1;
        if(e.handedness == "left") handedness = 0;
        else if(e.handedness == "right") handedness = 1;

        var targetRayMode = 0;
        if(e.targetRayMode == "tracked-pointer") targetRayMode = 1;
        else if(e.targetRayMode == "screen") targetRayMode = 2;

        setValue(offset + 0, handedness, 'i32');
        setValue(offset + 4, targetRayMode, 'i32');

        return offset + 8;
    },

    _set_input_callback: function(event, callback, userData) {
        var s = Module['webxr_session'];
        if(!s) return;
        if(!callback) return;

        s.addEventListener(event, function(e) {
            /* Nativize input source */
            var inputSource = Module._malloc(8); // 2*sizeof(int32)
            _nativize_input_source(inputSource, e.inputSource);

            /* Call native callback */
            dynCall('vii', callback, [inputSource, userData]);

            _free(inputSource);
        });
    },

    _set_session_callback: function(event, callback, userData) {
        var s = Module['webxr_session'];
        if(!s) return;
        if(!callback) return;

        s.addEventListener(event, function() {
            dynCall('vi', callback, [userData]);
        });
    }
},

webxr_init: function(frameCallback, startSessionCallback, endSessionCallback, errorCallback, userData) {
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

        var pose = frame.getDevicePose(WebXR._coordinateSystem);
        if(!pose) return;

        var SIZE_OF_WEBXR_VIEW = (16 + 16 + 4)*4;
        var views = Module._malloc(SIZE_OF_WEBXR_VIEW*2 + 16*4);

        frame.views.forEach(function(view) {
            var viewport = frame.session.baseLayer.getViewport(view);
            var viewMatrix = pose.getViewMatrix(view);
            var offset = views + SIZE_OF_WEBXR_VIEW*(view.eye == 'left' ? 0 : 1);

            // viewMatrix
            offset = WebXR._nativize_matrix(offset, viewMatrix);

            // projectionMatrix
            offset = WebXR._nativize_matrix(offset, view.projectionMatrix);

            // viewport
            setValue(offset + 0, viewport.x, 'i32');
            setValue(offset + 4, viewport.y, 'i32');
            setValue(offset + 8, viewport.width, 'i32');
            setValue(offset + 12, viewport.height, 'i32');
        });

        /* Model matrix */
        var modelMatrix = views + SIZE_OF_WEBXR_VIEW*2;
        WebXR._nativize_matrix(modelMatrix, pose.poseModelMatrix);

        Module.ctx.bindFramebuffer(Module.ctx.FRAMEBUFFER,
            session.baseLayer.framebuffer);
        /* HACK: This is not generally necessary, but chrome seems to detect whether the
         * page is sending frames by waiting for depth buffer clear or something */
        Module.ctx.clear(Module.ctx.DEPTH_BUFFER_BIT);

        /* Set and reset environment for webxr_get_input_pose calls */
        Module['webxr_frame'] = frame;
        dynCall('viiii', frameCallback, [userData, time, modelMatrix, views]);
        Module['webxr_frame'] = null;

        _free(views);
    };

    function onSessionStarted(session) {
        Module['webxr_session'] = session;

        // Change button on session end
        session.addEventListener('end', function() {
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
                WebXR._coordinateSystem = frameOfRef;
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
                Module['webxr_request_session'] = function() {
                    device.requestSession({immersive: true}).then(onSessionStarted);
                };
            });
        });
    } else {
        /* Call error callback with "WebXR not supported" */
        onError(-2);
    }
},

webxr_request_exit: function() {
    var s = Module['webxr_session'];
    if(s) Module['webxr_session'].end();
},

webxr_set_projection_params: function(near, far) {
    var s = Module['webxr_session'];
    if(!s) return;

    s.depthNear = near;
    s.depthFar = far;
},

webxr_set_session_blur_callback: function(callback, userData) {
    WebXR._set_session_callback("blur", callback, userData);
},

webxr_set_session_focus_callback: function(callback, userData) {
    WebXR._set_session_callback("focus", callback, userData);
},

webxr_set_select_callback: function(callback, userData) {
    _set_input_callback("select", callback, userData);
},
webxr_set_select_callback: function(callback, userData) {
    _set_input_callback("selectstart", callback, userData);
},
webxr_set_select_callback: function(callback, userData) {
    _set_input_callback("selectend", callback, userData);
},

webxr_get_input_sources: function(outArrayPtr, max, outCountPtr) {
    var s = Module['webxr_session'];
    if(!s) return; // TODO(squareys) warning or return error

    var sources = s.getInputSources();
    var i = 0;
    for (let inputSource of sources) {
        if(i >= max) break;
        outArrayPtr = _nativize_input_source(outArrayPtr, inputSource);
        ++i;
    }
    setValue(outCountPtr, i, 'i32');
},

webxr_get_input_sources: function(source, outPosePtr) {
    var f = Module['webxr_frame'];
    if(!f) return; // TODO(squareys) warning or return error

    pose = f.getInputPose(source, WebXR._coordinateSystem);

    offset = outPosePtr;
    /* WebXRRay */
    offset = WebXR._nativize_vec3(offset, pose.targetRay.origin);
    offset = WebXR._nativize_vec3(offset, pose.targetRay.direction);
    offset = WebXR._nativize_matrix(offset, pose.targetRay.transformMatrix);

    /* WebXRInputPose */
    offset = WebXR._nativize_matrix(offset, pose.gripMatrix);
    setValue(offset, pose.emulatedPosition, 'i32');
},

};

autoAddDeps(LibraryWebXR, '$WebXR');
mergeInto(LibraryManager.library, LibraryWebXR);
