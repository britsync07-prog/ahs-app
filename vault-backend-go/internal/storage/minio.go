package storage

import (
	"context"
	"fmt"
	"io"
	"os"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type Storage struct {
	Client *minio.Client
}

func NewClient() (*Storage, error) {
	endpoint := os.Getenv("MINIO_ENDPOINT")
	accessKey := os.Getenv("MINIO_USER")
	secretKey := os.Getenv("MINIO_PASSWORD")
	useSSL := false

	if endpoint == "" {
		endpoint = "localhost:9000"
	}

	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to initialize minio client: %v", err)
	}

	return &Storage{Client: client}, nil
}

func (s *Storage) BucketExists(ctx context.Context, bucketName string) (bool, error) {
	exists, err := s.Client.BucketExists(ctx, bucketName)
	if err != nil {
		return false, err
	}
	return exists, nil
}

func (s *Storage) EnsureBucket(ctx context.Context, bucketName string) error {
	exists, err := s.Client.BucketExists(ctx, bucketName)
	if err != nil {
		return err
	}
	if !exists {
		return s.Client.MakeBucket(ctx, bucketName, minio.MakeBucketOptions{})
	}
	return nil
}

func (s *Storage) UploadObject(ctx context.Context, bucketName, objectName string, reader io.Reader, size int64) error {
	_, err := s.Client.PutObject(ctx, bucketName, objectName,
		reader, size,
		minio.PutObjectOptions{ContentType: "application/octet-stream"})
	return err
}

func (s *Storage) GetObject(ctx context.Context, bucketName, objectName string, opts minio.GetObjectOptions) (io.ReadCloser, error) {
	return s.Client.GetObject(ctx, bucketName, objectName, opts)
}

func (s *Storage) GetBucketStats(ctx context.Context, bucketName string) (int64, int64, error) {
	var totalSize int64
	var count int64

	objectCh := s.Client.ListObjects(ctx, bucketName, minio.ListObjectsOptions{
		Prefix:    "",
		Recursive: true,
	})

	for object := range objectCh {
		if object.Err != nil {
			return 0, 0, object.Err
		}
		totalSize += object.Size
		count++
	}

	return count, totalSize, nil
}

func (s *Storage) DeleteObject(ctx context.Context, bucketName, objectName string) error {
	return s.Client.RemoveObject(ctx, bucketName, objectName, minio.RemoveObjectOptions{})
}
