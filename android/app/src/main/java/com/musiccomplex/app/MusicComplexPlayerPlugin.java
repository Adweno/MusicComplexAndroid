package com.musiccomplex.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

@CapacitorPlugin(name = "MusicComplexPlayer")
public class MusicComplexPlayerPlugin extends Plugin {
    private static MusicComplexPlayerPlugin activeInstance;
    private static final List<JSObject> pendingEvents = new ArrayList<>();

    @Override
    public void load() {
        activeInstance = this;
        MusicComplexPlayerService.setAppContext(getContext());
        flushPendingEvents();
    }

    @Override
    protected void handleOnDestroy() {
        if (activeInstance == this) {
            activeInstance = null;
        }
    }

    @PluginMethod
    public void play(PluginCall call) {
        MusicComplexPlayerService.setAppContext(getContext());
        JSArray tracks = call.getArray("tracks", new JSArray());
        int startIndex = call.getInt("startIndex", 0);
        double startTime = call.getDouble("startTime", 0.0);
        double volume = call.getDouble("volume", 1.0);
        boolean matchVolume = call.getBoolean("matchVolume", false);
        MusicComplexPlayerService.play(getContext(), tracks, startIndex, startTime, volume, matchVolume);
        call.resolve(new JSObject().put("ok", true));
    }

    @PluginMethod
    public void pause(PluginCall call) {
        MusicComplexPlayerService.pause();
        call.resolve(new JSObject().put("ok", true));
    }

    @PluginMethod
    public void resume(PluginCall call) {
        MusicComplexPlayerService.resume();
        call.resolve(new JSObject().put("ok", true));
    }

    @PluginMethod
    public void seek(PluginCall call) {
        MusicComplexPlayerService.seek(call.getDouble("position", 0.0));
        call.resolve(new JSObject().put("ok", true));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        MusicComplexPlayerService.stopPlayback();
        call.resolve(new JSObject().put("ok", true));
    }

    @PluginMethod
    public void volume(PluginCall call) {
        MusicComplexPlayerService.setVolume(call.getDouble("value", 1.0));
        call.resolve(new JSObject().put("ok", true));
    }

    @PluginMethod
    public void matchVolume(PluginCall call) {
        MusicComplexPlayerService.setMatchVolume(call.getBoolean("enabled", false));
        call.resolve(new JSObject().put("ok", true));
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(MusicComplexPlayerService.status());
    }

    static void emitPlayerEvent(JSObject payload) {
        MusicComplexPlayerPlugin plugin = activeInstance;
        if (plugin == null) {
            synchronized (pendingEvents) {
                pendingEvents.add(payload);
                while (pendingEvents.size() > 20) pendingEvents.remove(0);
            }
            return;
        }
        plugin.notifyListeners("player", payload);
    }

    private static void flushPendingEvents() {
        MusicComplexPlayerPlugin plugin = activeInstance;
        if (plugin == null) return;
        synchronized (pendingEvents) {
            Iterator<JSObject> iterator = pendingEvents.iterator();
            while (iterator.hasNext()) {
                plugin.notifyListeners("player", iterator.next());
            }
            pendingEvents.clear();
        }
    }
}
