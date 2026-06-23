package com.musiccomplex.app;

import android.os.Bundle;
import android.view.KeyEvent;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MusicComplexCastPlugin.class);
        registerPlugin(MusicComplexAutoPlugin.class);
        registerPlugin(MusicComplexPlayerPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_DOWN
            && MusicComplexCastPlugin.handleVolumeKey(event.getKeyCode())) {
            return true;
        }
        return super.dispatchKeyEvent(event);
    }
}
