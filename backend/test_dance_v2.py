# This file is a HEAVILY modified version of the project and example provided at:
# https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/python
# https://github.com/google-ai-edge/mediapipe-samples/tree/main/examples/pose_landmarker/python
# Gemini was used to help slightly optimize times, particularly in draw_landmarks_on_image(), greatly reducing computing time on my laptop!

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import subprocess

CONNECTIONS = np.array([(c.start, c.end) for c in vision.PoseLandmarksConnections.POSE_LANDMARKS],dtype=np.int32,)


def draw_landmarks_on_image(rgb_image, detection_result):
  img = rgb_image if rgb_image.flags.writeable else rgb_image.copy()
  h, w = img.shape[:2]
  scale = np.array([w, h], dtype=np.float32)

  for lms in detection_result.pose_landmarks:
    pts = (
        np.array([(l.x, l.y) for l in lms], dtype=np.float32) * scale
    ).astype(np.int32)
    cv2.polylines(img, pts[CONNECTIONS], False, (0, 255, 0), 2)
    for x, y in pts:
      cv2.circle(img, (int(x), int(y)), 3, (0, 0, 255), -1)

  return img

# STEP 2: Create an PoseLandmarker object.
base_options = python.BaseOptions(model_asset_path="pose_landmarker_heavy.task",
    delegate=python.BaseOptions.Delegate.GPU,  # GPU acceleration if available
)
options = vision.PoseLandmarkerOptions(base_options=base_options, running_mode=vision.RunningMode.VIDEO, output_segmentation_masks=False,)
detector = vision.PoseLandmarker.create_from_options(options)

# STEP 3: Load the input image.
# image = mp.Image.create_from_file("xr8848m.png")

# # STEP 4: Detect pose landmarks from the input image.
# detection_result = detector.detect(image)

# # STEP 5: Process the detection result. In this case, visualize it.
# annotated_image = draw_landmarks_on_image(image.numpy_view(), detection_result)
# cv2.imshow("image",cv2.cvtColor(annotated_image, cv2.COLOR_RGB2BGR))
# cv2.waitKey(0)
# cv2.destroyAllWindows()

# Load the video file
def AnalyzeVideo(filepath):
  cap = cv2.VideoCapture(filepath)
  frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
  frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
  fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

  # Check if the video opened correctly
  if not cap.isOpened():
    print("Error: Could not open video file.")
    print(filepath)
    exit()

  results = [] # compare with input later using np or something instead of list

  # write video
  fourcc = cv2.VideoWriter_fourcc(*"mp4v") # try h264?
  out = cv2.VideoWriter(f"{filepath[:-4]}_wireframe.mp4", fourcc, fps, (frame_width, frame_height)) # change output to become unique to each input bc concurrent processing could happen
  assert out.isOpened(), "VideoWriter failed to open"
  frame_idx = 0
  last_ts = -1
  # Read and display video frames
  with vision.PoseLandmarker.create_from_options(options) as detector:  # fresh per video
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        ts = int(cap.get(cv2.CAP_PROP_POS_MSEC))
        if ts <= 0 and frame_idx > 0:
            ts = int(round(frame_idx * 1000 / fps))
        if ts <= last_ts:
            ts = last_ts + 1
        last_ts = ts

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = detector.detect_for_video(mp_image, ts)
        results.append(result)

        annotated = draw_landmarks_on_image(mp_image.numpy_view(), result)
        out.write(cv2.cvtColor(annotated, cv2.COLOR_RGB2BGR))
        frame_idx += 1

    # Press Q to quit
      # if cv2.waitKey(25) & 0xFF == ord('q'):
      #     break

  # Release resources
  cap.release()
  out.release()
  # subprocess.run([
  #   "ffmpeg", "-y", "-i", f"{filepath[:-4]}_wireframe.mp4",
  #   "-c:v", "libx264", "-crf", "23", "-preset", "medium",
  #   "-pix_fmt", "yuv420p", f"{filepath[:-4]}_wireframe1.mp4",
  #   ], check=True)
  cv2.destroyAllWindows() # die
  print("Done!")
  return True