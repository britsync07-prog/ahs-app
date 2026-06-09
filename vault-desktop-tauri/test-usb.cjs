const fs = require('fs');
const path = require('path');
const drive = 'M:\\';

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runDeepTest() {
    console.log("Starting Deep USB-Drive Parity Test on M: drive...");
    
    try {
        // 1. Verify Drive exists
        if (!fs.existsSync(drive)) {
            throw new Error("M: drive is not mounted. Unlock the vault first!");
        }
        console.log("✅ M: drive detected.");

        // 2. Folder creation
        const testDir = path.join(drive, 'DeepTestFolder');
        console.log("1. Creating folder 'DeepTestFolder'...");
        if (!fs.existsSync(testDir)) fs.mkdirSync(testDir);
        await delay(500);
        if (!fs.existsSync(testDir)) throw new Error("Folder creation failed!");
        console.log("   ✅ Folder created.");

        // 3. File upload (Text)
        const testFile = path.join(testDir, 'secret_notes.txt');
        console.log("2. Uploading 'secret_notes.txt'...");
        fs.writeFileSync(testFile, 'Initial Secret Content - Do not share!');
        await delay(500);
        if (!fs.existsSync(testFile)) throw new Error("File upload failed!");
        console.log("   ✅ File uploaded.");

        // 4. File Read Verification
        console.log("3. Verifying file content...");
        const content = fs.readFileSync(testFile, 'utf8');
        if (content !== 'Initial Secret Content - Do not share!') {
            throw new Error("Content mismatch! Read: " + content);
        }
        console.log("   ✅ Content verified.");

        // 5. File edit (Overwrite)
        console.log("4. Editing file (Appending data)...");
        fs.appendFileSync(testFile, '\nAdded dynamic update info.');
        await delay(500);
        const updatedContent = fs.readFileSync(testFile, 'utf8');
        if (!updatedContent.includes('Added dynamic update info.')) {
            throw new Error("Edit failed! Read: " + updatedContent);
        }
        console.log("   ✅ File edit verified.");

        // 6. File rename
        const renamedFile = path.join(testDir, 'renamed_notes.txt');
        console.log("5. Renaming file to 'renamed_notes.txt'...");
        fs.renameSync(testFile, renamedFile);
        await delay(500);
        if (!fs.existsSync(renamedFile)) throw new Error("Rename failed!");
        if (fs.existsSync(testFile)) throw new Error("Old file still exists after rename!");
        console.log("   ✅ File renamed.");

        // 7. File delete
        console.log("6. Deleting file...");
        fs.unlinkSync(renamedFile);
        await delay(500);
        if (fs.existsSync(renamedFile)) throw new Error("Delete failed!");
        console.log("   ✅ File deleted.");

        // 8. Folder delete
        console.log("7. Deleting folder...");
        fs.rmdirSync(testDir);
        await delay(500);
        if (fs.existsSync(testDir)) throw new Error("Folder delete failed!");
        console.log("   ✅ Folder deleted.");

        console.log("\n🔥 FULL DEEP TEST PASSED SUCCESSFULLY! 🔥");
        console.log("The Vault is working 100% like a portable USB drive.");
    } catch (e) {
        console.error("\n❌ DEEP TEST FAILED:", e.message);
        process.exit(1);
    }
}

runDeepTest();