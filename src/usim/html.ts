import { Canvas, createCanvas, createImageData, loadImage } from 'canvas';
import * as trace from './trace';
import { tv_bitmap, tv_height, tv_width } from './tv';
import { ucfg } from './ucfg';

let canvas: Canvas = createCanvas(100, 100);
let ctx = canvas.getContext("2d");
let icon: any;
let imageData = createImageData(tv_width, tv_height);
let scale = 1;

export function set_video_scale(n: number): void {
    scale = n;
}

export function html_init(): void {
    canvas = createCanvas(tv_width, tv_height);
    ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    imageData = createImageData(tv_bitmap, tv_width, tv_height);
    ctx.drawImage(imageData, 0, 0);

    loadImage(ucfg.icon_file).then((img) => {
        icon = img;
        if (icon.width != 32 || icon.height != 32) {
            trace.warning(trace.USIM, `icon is expected to be 32x32`);
        }
    });

    canvas.add
}

