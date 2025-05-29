# DeepChecker

A fast and accurate image duplication detection tool that combines CLIP (Contrastive Language-Image Pre-Training) and SIFT (Scale-Invariant Feature Transform) algorithms to identify duplicate and similar images.



<img src="images/logo/logo.png" alt="logo" style="zoom:33%;" />


## Features

<img width="671" alt="image" src="https://github.com/user-attachments/assets/93da55ad-3ba2-40ac-b189-b40cd4f2ee54" />


- **Dual-Algorithm Analysis**: Combines CLIP for semantic similarity and SIFT for local feature matching
- **Multiple Format Support**: Handles various image formats (JPEG, PNG, GIF, BMP, TIFF) and PDFs
- **Real-time Progress**: Shows analysis progress during SIFT verification
- **Interactive UI**: Drag-and-drop interface with file preview
- **Detailed Results**:
  - Top 10 similar pairs with similarity scores
  - Duplicate image groups
  - Local feature matches count
  - CLIP similarity scores
- **Export Functionality**: Download top 50 similar pairs as CSV



## Tech Stack

### Frontend

- React
- TypeScript
- Tailwind CSS
- Lucide Icons

### Backend

- Python
- FastAPI
- OpenCV (SIFT)
- CLIP (OpenAI)
- PyTorch



# Use it on server

1. **Upload Images**:
   - Drag and drop images/PDFs into the upload area
   - Or click "Select Files" to choose files
   - Or click "Select Folder" to upload an entire folder

2. **Analysis**:
   - Click "Analyze" to start processing
   - Watch the progress bar for SIFT verification progress
   - View results in real-time

3. **Results**:
   - View top 5 similar pairs with similarity scores
   - Check duplicate groups if found
   - Download top 20 similar pairs as CSV

4. **CSV Export Format**:
   - Pair Number
   - Image 1 filename
   - Image 2 filename
   - CLIP Score (%)
   - Local Matches count



# Deploy server

```
# front end 
mamba install nodejs

# back end
mamba install sse-starlette fastapi -y
```



```
conda activate dev

# back
nohup python app.py &>log/1.log &
uvicorn app:app --host 0.0.0.0 --port 8890 --log-level debug

# front
npm run dev 
npm run dev -- --port 8888
npm run dev -- --port 8888 --host 0.0.0.0
```



check open port:

```
netstat -tuln | grep 8888
sudo ss -tulpn
```

```
sudo ufw allow 8890/tcp
sudo ufw show added
sudo netstat -tuln | grep 8890
```



## Use reverse proxy

```
I can only use port 8888 which is allowed by the sucure group rule, so help me use nginx to use Nginx as a reverse proxy use port 3000 for backend and 3001 for frontend.

I would like to deploy this project for frontend on port 8888, I run `npm run dev -- --port 8888 --host 0.0.0.0`, and `python app.py` on my server to run this project. And the server can be access it by `10.112.31.24:8888`. I can only use port 8888 which is allowed by the sucure group rule, so help me use nginx to use Nginx as a reverse proxy use port 3000 and 3001
```



nginx:

```
 sudo cp nginx.conf /etc/nginx/nginx.conf
```



```
sudo systemctl stop nginx
sudo systemctl status nginx
sudo systemctl restart nginx
```



```
npm run dev -- --port 3001 --host 0.0.0.0
python app.py

TIMESTAMP=$(date +"%Y%m%d_%H%M%S") && nohup python app.py > logs/backend_${TIMESTAMP}.log 2>&1 & echo $! > logs/backend_${TIMESTAMP}.pid
TIMESTAMP=$(date +"%Y%m%d_%H%M%S") && nohup npm run start > logs/frontend_${TIMESTAMP}.log 2>&1 & echo $! > logs/frontend_${TIMESTAMP}.pid
# TIMESTAMP=$(date +"%Y%m%d_%H%M%S") && nohup npm run dev > logs/frontend_${TIMESTAMP}.log 2>&1 & echo $! > logs/frontend_${TIMESTAMP}.pid

# TIMESTAMP=$(date +"%Y%m%d_%H%M%S") && nohup npm run dev -- --port 3001 --host 0.0.0.0 > logs/frontend_${TIMESTAMP}.log 2>&1 & echo $! > logs/frontend_${TIMESTAMP}.pid
```



## use forever check status

```
npm install -g forever
# mkdir -p ~/.forever/deepcheck

TIMESTAMP=$(date +"%Y%m%d_%H%M%S") && npm run start & echo $! > logs/frontend_${TIMESTAMP}.pid

# check forever log in forever list
forever list
```



```
"start": "forever start -c 'node signalHandler.js' .",
```





## Difference between local and server

`src/components/FileUpload.tsx`  and `hooks/useFileUpload.ts`

but use a tricky, use `API_BASE_URL` to vary based on domain status:

```
const API_BASE_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:3000/api'
  : 'http://10.112.31.24:8080/api';

...
const response = await fetch(`${API_BASE_URL}/cleanup/${state.sessionId}`, {
...
```

but for real domain name such as "http://fscpo.fhs.um.edu.mo:8080/"?



also the `node_modules` are different.

```
/home/data/yzpeng/2-Project/DuplicateCheckerWeb2/software/node_modules/rollup/dist/native.js:59
                throw new Error(
                      ^

Error: Cannot find module @rollup/rollup-linux-x64-gnu. npm has a bug related to optional dependencies (https://github.com/npm/cli/issues/4828). Please try `npm i` again after removing both package-lock.json and node_modules directory.
    at requireWithFriendlyError (/home/data/yzpeng/2-Project/DuplicateCheckerWeb2/software/node_modules/rollup/dist/native.js:59:9)
    at Object.<anonymous> (/home/data/yzpeng/2-Project/DuplicateCheckerWeb2/software/node_modules/rollup/dist/native.js:68:76)
    at Module._compile (node:internal/modules/cjs/loader:1565:14)
    at Module._extensions..js (node:internal/modules/cjs/loader:1708:10)
    at Module.load (node:internal/modules/cjs/loader:1318:32)
    at Module._load (node:internal/modules/cjs/loader:1128:12)
    at TracingChannel.traceSync (node:diagnostics_channel:322:14)
    at wrapModuleLoad (node:internal/modules/cjs/loader:219:24)
    at cjsLoader (node:internal/modules/esm/translators:263:5)
    at ModuleWrap.<anonymous> (node:internal/modules/esm/translators:196:7) {
  [cause]: Error: Cannot find module '@rollup/rollup-linux-x64-gnu'
```





# Deploy local by conda 

download conda:

```
wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh
bash Miniconda3-latest-Linux-x86_64.sh 
```



Setup:

```
mamba create -n dev python=3.12 -y 
conda activate dev 
mamba install numpy pillow opencv pytorch torchvision openai-clip glob2 pdf2image ipykernel -y 
# mamba install pdf2image -y
# mamba install ipykernel -y 
# mamba install openai-clip glob2 -y
# pip install ftfy regex tqdm 
```



run script:

```
python clip_sift_search.py <folder_path>
```





# Change other models

[sentence-transformers/clip-ViT-B-32 · Hugging Face](https://huggingface.co/sentence-transformers/clip-ViT-B-32)

|                            Model                             | Top 1 Performance |
| :----------------------------------------------------------: | ----------------- |
| [clip-ViT-B-32](https://huggingface.co/sentence-transformers/clip-ViT-B-32) | 63.3              |
| [clip-ViT-B-16](https://huggingface.co/sentence-transformers/clip-ViT-B-16) | 68.1              |
| [clip-ViT-L-14](https://huggingface.co/sentence-transformers/clip-ViT-L-14) | 75.4              |

For a multilingual version of the CLIP model for 50+ languages have a look at: [clip-ViT-B-32-multilingual-v1](https://huggingface.co/sentence-transformers/clip-ViT-B-32-multilingual-v1)



# Others

## Limitations

- Maximum recommended batch size: Depends on available memory
- PDF processing may take longer due to conversion
- GPU acceleration

## Credits

Developed by UM_DengLab

- Contact: Peng, yc47680@um.edu.mo
- GitHub: https://github.com/mugpeng
