package com.musiccomplex.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

@CapacitorPlugin(name = "MusicComplexAuto")
public class MusicComplexAutoPlugin extends Plugin {
    private static MusicComplexAutoPlugin activeInstance;
    private static final List<JSObject> pendingTransports = new ArrayList<>();

    @Override
    public void load() {
        activeInstance = this;
        MusicComplexAutoService.ensureSession(getContext());
        flushPendingTransports();
    }

    @Override
    protected void handleOnDestroy() {
        if (activeInstance == this) {
            activeInstance = null;
        }
    }

    @PluginMethod
    public void update(PluginCall call) {
        MusicComplexAutoService.ensureSession(getContext());
        MusicComplexAutoService.updateFromJs(call.getData());
        call.resolve(new JSObject().put("ok", true));
    }

    @PluginMethod
    public void catalog(PluginCall call) {
        MusicComplexAutoService.ensureSession(getContext());
        MusicComplexAutoService.updateCatalog(call.getData());
        call.resolve(new JSObject().put("ok", true));
    }

    static void emitTransport(String action) {
        emitTransport(action, new JSObject());
    }

    static void emitTransport(String action, JSObject extra) {
        MusicComplexAutoPlugin plugin = activeInstance;
        JSObject payload = new JSObject();
        payload.put("action", action);
        Iterator<String> keys = extra.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            payload.put(key, extra.opt(key));
        }
        if (plugin == null) {
            synchronized (pendingTransports) {
                pendingTransports.add(payload);
                while (pendingTransports.size() > 10) pendingTransports.remove(0);
            }
            return;
        }
        plugin.notifyListeners("transport", payload);
    }

    private static void flushPendingTransports() {
        MusicComplexAutoPlugin plugin = activeInstance;
        if (plugin == null) return;
        synchronized (pendingTransports) {
            for (JSObject payload : pendingTransports) {
                plugin.notifyListeners("transport", payload);
            }
            pendingTransports.clear();
        }
    }
}
