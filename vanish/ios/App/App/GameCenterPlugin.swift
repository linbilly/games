import Foundation
import Capacitor
import GameKit

@objc(GameCenterPlugin)
public class GameCenterPlugin: CAPPlugin {
    
    @objc func signIn(_ call: CAPPluginCall) {
        // This will print to the XCODE console (not Safari)
        print("🎮 GAME CENTER: JavaScript requested login...")
        
        DispatchQueue.main.async {
            let localPlayer = GKLocalPlayer.local
            
            print("🎮 GAME CENTER: Asking Apple for authentication...")
            
            localPlayer.authenticateHandler = { viewController, error in
                print("🎮 GAME CENTER: Apple responded!")
                
                if let error = error {
                    print("🎮 GAME CENTER: Error - \(error.localizedDescription)")
                    call.reject("Game Center Auth Failed", error.localizedDescription)
                    return
                }
                
                if let vc = viewController {
                    print("🎮 GAME CENTER: Showing Apple Login Popup...")
                    self.bridge?.viewController?.present(vc, animated: true, completion: nil)
                    // Note: If Apple shows the popup, it will fire this handler a SECOND time once the user finishes.
                } else if localPlayer.isAuthenticated {
                    print("🎮 GAME CENTER: Success! User is \(localPlayer.alias)")
                    call.resolve([
                        "player_id": localPlayer.teamPlayerID,
                        "player_name": localPlayer.alias
                    ])
                } else {
                    print("🎮 GAME CENTER: User declined or unauthenticated.")
                    call.reject("User declined Game Center login")
                }
            }
        }
    }
}
