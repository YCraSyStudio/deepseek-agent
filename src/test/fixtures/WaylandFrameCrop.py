"""Exercise the actual crop/encode pipeline using owned synthetic frame buffers."""
import base64
import ctypes
import json
import os
import sys

scope = {"__name__": "crop_test"}
with open(sys.argv[1]) as helper:
    exec(helper.read(), scope)
Gst = scope["Gst"]
Gst.init(None)
library = ctypes.CDLL("libgstvideo-1.0.so.0")
library.gst_video_crop_meta_get_info.restype = ctypes.c_void_p
library.gst_video_crop_meta_get_info()

options = json.loads(sys.argv[3])
width, height = options["width"], options["height"]
region = options.get("crop")
pixels = bytes(options["pixels"])
pipeline = Gst.parse_launch("appsrc name=source format=time ! videocrop name=crop ! videoconvert ! video/x-raw,format=RGB ! pngenc snapshot=true ! filesink name=sink")
pipeline.get_by_name("sink").set_property("location", sys.argv[2])
source = pipeline.get_by_name("source")
source.set_property("caps", Gst.Caps.from_string("video/x-raw,width=%d,height=%d,format=RGB,framerate=1/1" % (width, height)))
failures = []
scope["attach_frame_crop"](source, pipeline.get_by_name("crop"), options.get("sourceType", 2), failures.append)
buffer = Gst.Buffer.new_allocate(None, len(pixels), None)
buffer.fill(0, pixels)
if region is not None:
    meta = buffer.add_meta(Gst.Meta.get_info("GstVideoCropMeta"), None)
    native = scope["VideoCropMeta"].from_address(hash(meta))
    native.x, native.y, native.width, native.height = region
try:
    pipeline.set_state(Gst.State.PLAYING)
    source.emit("push-buffer", buffer)
    source.emit("end-of-stream")
    message = pipeline.get_bus().timed_pop_filtered(5 * Gst.SECOND, Gst.MessageType.ERROR | Gst.MessageType.EOS)
    if message is None:
        raise RuntimeError("Fixture did not finish encoding")
    if message.type == Gst.MessageType.ERROR and not failures:
        raise RuntimeError(str(message.parse_error()))
finally:
    pipeline.set_state(Gst.State.NULL)
if failures:
    print(json.dumps({"error": failures[0], "bytes": os.path.getsize(sys.argv[2])}))
    sys.exit(0)

# Decode through the real PNG decoder and compare pixels, not just PNG dimensions.
decoder = Gst.parse_launch("filesrc name=source ! pngdec ! videoconvert ! video/x-raw,format=RGB ! appsink name=sink sync=false")
decoder.get_by_name("source").set_property("location", sys.argv[2])
try:
    decoder.set_state(Gst.State.PLAYING)
    sample = decoder.get_by_name("sink").emit("try-pull-sample", 5 * Gst.SECOND)
    if sample is None:
        raise RuntimeError("Fixture did not decode PNG")
    caps = sample.get_caps().get_structure(0)
    w, h = caps.get_value("width"), caps.get_value("height")
    raw = sample.get_buffer().extract_dup(0, sample.get_buffer().get_size())
    stride = len(raw) // h
    decoded = b"".join(raw[row * stride:row * stride + w * 3] for row in range(h))
    print(json.dumps({"width": w, "height": h, "pixels": base64.b64encode(decoded).decode("ascii")}))
finally:
    decoder.set_state(Gst.State.NULL)
