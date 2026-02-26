#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(GameCenterPlugin, "GameCenterPlugin",
           CAP_PLUGIN_METHOD(signIn, CAPPluginReturnPromise);
)
