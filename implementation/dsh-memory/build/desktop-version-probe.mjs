import fs from 'node:fs';
import {join} from 'node:path';import {desktopResources} from '../tests/desktop-runtime.mjs';
const archive=join(desktopResources(),'app.asar');const fd=fs.openSync(archive,'r'),size=Buffer.alloc(8);fs.readSync(fd,size,0,8,0);const headerSize=size.readUInt32LE(4),header=Buffer.alloc(headerSize);fs.readSync(fd,header,0,headerSize,8);const tree=JSON.parse(header.subarray(8,8+header.readUInt32LE(4)).toString());
function entry(path){let value=tree;for(const part of path.split('/')){value=value.files?.[part];if(!value)return}return value}
function read(path){const item=entry(path);if(!item||!item.size||item.unpacked)return;const data=Buffer.alloc(item.size);fs.readSync(fd,data,0,item.size,8+headerSize+Number(item.offset));return data.toString()}
const result={installedDesktopRegistry:'0.2.0-rc.2',desktopNode:'24.21.0',archive};for(const path of ['package.json','dsh/package.json','dsh/node_modules/@deepseek-ai/dsh/package.json']){const text=read(path);if(text){const pkg=JSON.parse(text);result[path]={name:pkg.name,version:pkg.version}}}
fs.closeSync(fd);fs.writeFileSync('evidence/desktop-version.json',JSON.stringify(result,null,2));console.log(result)
