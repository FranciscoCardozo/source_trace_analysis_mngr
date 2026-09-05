FROM python:3.12-slim
WORKDIR /opt/model-loader
RUN pip install --no-cache-dir huggingface_hub hf_xet
COPY download_model.py .
CMD ["python", "download_model.py"]
