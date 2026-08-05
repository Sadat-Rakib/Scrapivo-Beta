import { useEffect, useRef, useState } from "react";

/**
 * Off-center (~62% across) cool platinum-white WebGL beam.
 * Falls back to a CSS gradient when WebGL is unavailable.
 */
export function HeroBeam() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [glReady, setGlReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl");
    if (!gl) return;

    const vs = `attribute vec4 aP;void main(){gl_Position=aP;}`;
    const fs = `
      precision highp float;
      uniform vec2 uR; uniform float uT;
      uniform float uBeamX; uniform float uBeamWidth;
      float rnd(vec2 s){return fract(sin(dot(s,vec2(12.9898,78.233)))*43758.5453);}
      float nse(vec2 s){
        vec2 i=floor(s),f=fract(s);
        float a=rnd(i),b=rnd(i+vec2(1.,0.)),c=rnd(i+vec2(0.,1.)),d=rnd(i+vec2(1.,1.));
        vec2 u=f*f*(3.-2.*f);return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y;
      }
      float fbm(vec2 s){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*nse(s);s*=2.;a*=.5;}return v;}
      void main(){
        vec2 uv=(gl_FragCoord.xy/uR.xy)*2.-1.; uv.x*=uR.x/uR.y;
        float beamOffset=(uBeamX-0.5)*2.0*(uR.x/uR.y);
        vec2 buv=uv; buv.x-=beamOffset;
        float t=uT*.2;
        float f1=fbm(buv*1.5+vec2(t*.2,-t*.5)),f2=fbm(buv*2.5+vec2(-t*.3,-t*.7)+5.2);
        float cf=(f1+f2)*.4;
        float d=abs(buv.x)/uBeamWidth, p=sin(uT*2.)*.5+.5;
        float g=.022/(d+.025)*(.7+.3*p), s=cf*smoothstep(1.5,0.,d)*1.5;
        vec3 c=vec3(.015,.015,.018)+vec3(.14,.16,.20)*cf + vec3(.72,.80,.95)*g + vec3(.55,.65,.85)*s + vec3(.85,.90,1.)*(.001/(d+.0005));
        gl_FragColor=vec4(c*smoothstep(2.,.2,length(uv*vec2(.5,1.))),1.);
      }`;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src); gl.compileShader(sh); return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,1,1,1,-1,-1,1,-1]), gl.STATIC_DRAW);
    const aP = gl.getAttribLocation(prog, "aP");
    gl.enableVertexAttribArray(aP);
    gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);
    const uR = gl.getUniformLocation(prog, "uR");
    const uT = gl.getUniformLocation(prog, "uT");
    const uBeamX = gl.getUniformLocation(prog, "uBeamX");
    const uBeamWidth = gl.getUniformLocation(prog, "uBeamWidth");

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(680 * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    window.addEventListener("resize", resize);
    resize();
    setGlReady(true);

    let raf = 0;
    const render = (t: number) => {
      gl.useProgram(prog);
      gl.uniform2f(uR, canvas.width, canvas.height);
      gl.uniform1f(uT, t * 0.001);
      gl.uniform1f(uBeamX, 0.62);
      gl.uniform1f(uBeamWidth, 1.25);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div
      aria-hidden
      className="absolute inset-x-0 top-0 z-0 h-[680px] overflow-hidden pointer-events-none"
      style={{
        maskImage: "linear-gradient(to bottom, black 45%, transparent)",
        WebkitMaskImage: "linear-gradient(to bottom, black 45%, transparent)",
      }}
    >
      {!glReady && (
        <div className="absolute inset-0">
          <div
            className="absolute top-0 bottom-0"
            style={{
              left: "62%", width: "3px", transform: "translateX(-50%)",
              background:
                "linear-gradient(to bottom, transparent 0%, rgba(180,200,230,0.85) 35%, rgba(140,165,210,0.55) 80%, transparent 100%)",
              filter: "blur(1px)",
            }}
          />
          <div
            className="absolute"
            style={{
              left: "62%", top: "10%", width: "55vw", height: "70%",
              transform: "translateX(-50%)",
              background:
                "radial-gradient(closest-side, rgba(160,185,225,0.30), rgba(120,150,200,0.10) 55%, transparent 75%)",
              filter: "blur(60px)",
            }}
          />
        </div>
      )}
      <canvas ref={canvasRef} className="relative w-full h-full block" />
    </div>
  );
}
