package com.kashima.spotidown;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MusicPlugin.class);   // tu música del celular (MusicPlugin.java)
        super.onCreate(savedInstanceState);
    }
}
