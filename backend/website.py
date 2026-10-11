# This was largely cobbled together with flask documentation. First time doing backend! :O (very apparent)
# https://flask.palletsprojects.com/en/stable/quickstart/
from flask import Flask
from flask_cors import CORS
import test_dance_v2
import subprocess
import os
home_dir = os.path.expanduser("~")
app = Flask(__name__)
CORS(app)
@app.route("/")
def hello_world():
    return "<p>Hello, World!</p>"

@app.route("/test")
def test():
    return "<p>test!</p>"

from werkzeug.utils import secure_filename
import os
from flask import Flask, flash, request, redirect, url_for, request, send_file, abort
from werkzeug.utils import secure_filename

# SOURCE: https://flask.palletsprojects.com/en/stable/patterns/fileuploads/

UPLOAD_FOLDER = f'{home_dir}/Documents/HackNC/step-dance-hacknc2026/backend/uploads/'
ALLOWED_EXTENSIONS = {'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif'}

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def transcode_to_h264(input_path, output_path):
  # FFmpeg command to transcode video to H.264 (libx264) and audio to AAC
  command = [
      "ffmpeg",
      "-i",
      input_path,
      "-c:v",
      "libx264",
      "-crf",
      "23",  # Quality control: lower means better quality (23 is standard)
      "-preset",
      "medium",  # Speed/compression tradeoff (ultrafast, fast, medium, slow, etc.)
      "-c:a",
      "aac",  # Standard audio codec for MP4 compatibility
      "-r", "30", "-fps_mode", "cfr",
      output_path,
  ]

  try:
    print(f"Starting transcode for {input_path}...")
    subprocess.run(command, check=True)
    print(f"Successfully saved transcoded video to: {output_path}")
  except subprocess.CalledProcessError as e:
    print(f"Error during transcoding: {e}")


# Example usage:
transcode_to_h264("input.mp4", "output_h264.mp4")

@app.route('/upload', methods=['POST'])
def upload_file():
    if request.method == 'POST':
        # check if the post request has the file part
        if 'file' not in request.files and 'video' not in request.files:
            # flash('No file part')
            return redirect(request.url)
        
        # If the user does not select a file, the browser submits an
        # empty file without a filename.
        if 'file' in request.files:
            file = request.files['file']
            if file.filename == '':
                flash('No selected file')
                return redirect(request.url)
            if file and allowed_file(file.filename):
                filename = secure_filename(file.filename)
                file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
            return redirect(url_for('upload_file', name=filename))
        elif 'video' in request.files:
            file = request.files['video']
            if file:
                video_file = request.files["video"]
                file_path = os.path.join(UPLOAD_FOLDER, video_file.filename)
                video_file.save(file_path)

                transcode_to_h264(f"{UPLOAD_FOLDER}{video_file.filename}", 
                f"{UPLOAD_FOLDER}h264_{video_file.filename}")
                test_dance_v2.AnalyzeVideo(f"{UPLOAD_FOLDER}h264_{video_file.filename}")
                    # print("hit!")
            
    return '''
    <!doctype html>
    <title>Upload new File</title>
    <h1>Upload new File</h1>
    <form method=post enctype=multipart/form-data>
      <input type=file name=file>
      <input type=submit value=Upload>
    </form>'''

@app.route("/download", methods=["GET"])
def download_file():
  # needs to be url?filename=[filename]
  requested_filename = request.args.get("filename")

  if not requested_filename: # if no filename
    abort(400, description="Missing 'filename' query parameter.")

  filename = secure_filename(requested_filename)
  file_path = os.path.join(UPLOAD_FOLDER, filename)

  if not os.path.isfile(file_path):
    abort(404, description="File not found.")

  return send_file(file_path, as_attachment=True, mimetype='video/webm')