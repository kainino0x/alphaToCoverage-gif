import { GUI } from 'dat.gui';

import showMultisampleTextureWGSL from './showMultisampleTexture.wgsl';
import renderWithAlphaToCoverageWGSL from './renderWithAlphaToCoverage.wgsl';
import { quitIfWebGPUNotAvailable } from '../util';

const canvas = document.querySelector('canvas') as HTMLCanvasElement;
const adapter = await navigator.gpu?.requestAdapter();
const device = await adapter?.requestDevice();
quitIfWebGPUNotAvailable(adapter, device);

//
// GUI controls
//

const kInitConfig = {
  width: 8,
  height: 8,
  alpha: 0,
  pause: false,
};
const config = { ...kInitConfig };
const updateAlpha = () => {
  if (!config.pause) {
    config.alpha = (performance.now() / 10000) % 1.2 - 0.1;
    gui.updateDisplay();
  }

  const data = new Float32Array([config.alpha]);
  device.queue.writeBuffer(bufConfig, 0, data);
};

const gui = new GUI();
{
  const buttons = {
    initial() {
      Object.assign(config, kInitConfig);
      gui.updateDisplay();
    },
  };
  const presets = gui.addFolder('Presets');
  presets.open();
  presets.add(buttons, 'initial').name('reset to initial');

  const settings = gui.addFolder('Settings');
  settings.open();
  settings.add(config, 'width', 1, 16, 1);
  settings.add(config, 'height', 1, 16, 1);
  settings.add(config, 'alpha', -0.1, 1.1, 0.01);
  settings.add(config, 'pause', false);
}

//
// Canvas setup
//

const devicePixelRatio = window.devicePixelRatio;
canvas.width = canvas.clientWidth * devicePixelRatio;
canvas.height = canvas.clientHeight * devicePixelRatio;
const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

const context = canvas.getContext('webgpu') as GPUCanvasContext;
context.configure({
  device,
  format: presentationFormat,
  alphaMode: 'premultiplied',
});

//
// Config buffer
//

const bufConfig = device.createBuffer({
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
  size: 128,
});

//
// Pipeline to render to a multisampled texture using alpha-to-coverage
//

const renderWithAlphaToCoverageModule = device.createShaderModule({
  code: renderWithAlphaToCoverageWGSL,
});
const renderWithAlphaToCoveragePipeline = device.createRenderPipeline({
  label: 'renderWithAlphaToCoveragePipeline',
  layout: 'auto',
  vertex: { module: renderWithAlphaToCoverageModule },
  fragment: {
    module: renderWithAlphaToCoverageModule,
    targets: [{ format: 'rgba16float' }],
  },
  multisample: { count: 4, alphaToCoverageEnabled: true },
  primitive: { topology: 'triangle-list' },
});
const renderWithAlphaToCoverageBGL =
  renderWithAlphaToCoveragePipeline.getBindGroupLayout(0);

const renderWithAlphaToCoverageBG = device.createBindGroup({
  layout: renderWithAlphaToCoverageBGL,
  entries: [{ binding: 0, resource: { buffer: bufConfig } }],
});

//
// "Debug" view of the actual texture contents
//

const showMultisampleTextureModule = device.createShaderModule({
  code: showMultisampleTextureWGSL,
});
const showMultisampleTexturePipeline = device.createRenderPipeline({
  label: 'showMultisampleTexturePipeline',
  layout: 'auto',
  vertex: { module: showMultisampleTextureModule },
  fragment: {
    module: showMultisampleTextureModule,
    targets: [{ format: presentationFormat }],
  },
  primitive: { topology: 'triangle-list' },
});
const showMultisampleTextureBGL =
  showMultisampleTexturePipeline.getBindGroupLayout(0);

function frame() {
  updateAlpha();

  const multisampleTexture = device.createTexture({
    format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    size: [config.width, config.height],
    sampleCount: 4,
  });
  const multisampleTextureView = multisampleTexture.createView();

  const showMultisampleTextureBG = device.createBindGroup({
    layout: showMultisampleTextureBGL,
    entries: [{ binding: 0, resource: multisampleTextureView }],
  });

  const commandEncoder = device.createCommandEncoder();
  // renderWithAlphaToCoverage pass
  {
    const pass = commandEncoder.beginRenderPass({
      label: 'renderWithAlphaToCoverage pass',
      colorAttachments: [
        {
          view: multisampleTextureView,
          clearValue: [0, 0, 0, 1], // will be overwritten
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(renderWithAlphaToCoveragePipeline);
    pass.setBindGroup(0, renderWithAlphaToCoverageBG);
    pass.draw(6);
    pass.end();
  }
  // showMultisampleTexture pass
  {
    const pass = commandEncoder.beginRenderPass({
      label: 'showMulitsampleTexture pass',
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: [1, 0, 1, 1], // error color, will be overwritten
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(showMultisampleTexturePipeline);
    pass.setBindGroup(0, showMultisampleTextureBG);
    pass.draw(6);
    pass.end();
  }
  device.queue.submit([commandEncoder.finish()]);

  multisampleTexture.destroy();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
