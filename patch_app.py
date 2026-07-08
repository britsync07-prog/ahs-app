import sys

with open('vault-desktop-tauri/src/App.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

old_code = '''    const unlistenPairing = listen<{ public_key: string; x_public_key: string }>("pairing-success", (event) => {
       console.log("Pairing success event received:", event.payload);
       setMobileKeys(event.payload);
       // handleGenerateMasterKey(); // REMOVED: Identity is already established in initIdentity()
       setOnboardingStep("master-key");
    });'''

new_code = '''    const unlistenPairing = listen<{ public_key: string; x_public_key: string }>("pairing-success", (event) => {
       console.log("Pairing success event received:", event.payload);
       setMobileKeys(event.payload);
       // Check if we are already onboarded, if so we don't change onboarding step
       invoke<boolean>("check_onboarding").then((isOnboarded) => {
           if (!isOnboarded) {
               setOnboardingStep("master-key");
           }
       });
    });'''

c = c.replace(old_code, new_code)

with open('vault-desktop-tauri/src/App.tsx', 'w', encoding='utf-8') as f:
    f.write(c)
