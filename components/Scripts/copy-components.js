const fse = require('fs-extra');
const path = require('path');

const sourceDir = path.join(__dirname, '..', '..', 'components');
const targetDir = path.join(__dirname, '..', '..', 'node_modules', 'electron', 'dist', 'components');

async function copyComponents() {
    try {
        console.log('Copying components folder to electron dist...');
        console.log(`Source: ${sourceDir}`);
        console.log(`Target: ${targetDir}`);
        
        // Remove existing components folder in dist if it exists
        await fse.remove(targetDir);
        
        // Copy components folder
        await fse.copy(sourceDir, targetDir);
        
        console.log('Components folder copied successfully!');
    } catch (error) {
        console.error('Error copying components folder:', error);
        process.exit(1);
    }
}

copyComponents();