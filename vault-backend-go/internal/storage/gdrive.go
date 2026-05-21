package storage

import (
	"context"
	"fmt"
	"io"

	"golang.org/x/oauth2"
	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
)

type GDriveStorage struct{}

func NewGDriveStorage() *GDriveStorage {
	return &GDriveStorage{}
}

func (s *GDriveStorage) getClient(ctx context.Context, token string) (*drive.Service, error) {
	if token == "" {
		return nil, fmt.Errorf("missing google token")
	}
	ts := oauth2.StaticTokenSource(&oauth2.Token{AccessToken: token})
	tc := oauth2.NewClient(ctx, ts)
	return drive.NewService(ctx, option.WithHTTPClient(tc))
}

func (s *GDriveStorage) EnsureVaultFolder(ctx context.Context, token string) (string, error) {
	srv, err := s.getClient(ctx, token)
	if err != nil {
		return "", err
	}

	q := "name='SecureVault' and mimeType='application/vnd.google-apps.folder' and trashed=false"
	r, err := srv.Files.List().Q(q).Spaces("drive").Do()
	if err != nil {
		return "", err
	}

	if len(r.Files) > 0 {
		return r.Files[0].Id, nil
	}

	folder := &drive.File{
		Name:     "SecureVault",
		MimeType: "application/vnd.google-apps.folder",
	}
	f, err := srv.Files.Create(folder).Do()
	if err != nil {
		return "", err
	}
	return f.Id, nil
}

func (s *GDriveStorage) UploadObject(ctx context.Context, token string, objectName string, reader io.Reader) (string, error) {
	srv, err := s.getClient(ctx, token)
	if err != nil {
		return "", err
	}

	folderId, err := s.EnsureVaultFolder(ctx, token)
	if err != nil {
		return "", err
	}

	f := &drive.File{
		Name:    objectName,
		Parents: []string{folderId},
	}

	res, err := srv.Files.Create(f).Media(reader).Do()
	if err != nil {
		return "", err
	}
	return res.Id, nil
}

func (s *GDriveStorage) GetObject(ctx context.Context, token string, objectName string) (io.ReadCloser, error) {
	srv, err := s.getClient(ctx, token)
	if err != nil {
		return nil, err
	}

	folderId, err := s.EnsureVaultFolder(ctx, token)
	if err != nil {
		return nil, err
	}

	q := fmt.Sprintf("name='%s' and '%s' in parents and trashed=false", objectName, folderId)
	r, err := srv.Files.List().Q(q).Spaces("drive").Do()
	if err != nil {
		return nil, err
	}

	if len(r.Files) == 0 {
		return nil, fmt.Errorf("object not found")
	}

	res, err := srv.Files.Get(r.Files[0].Id).Download()
	if err != nil {
		return nil, err
	}
	return res.Body, nil
}

func (s *GDriveStorage) DeleteObject(ctx context.Context, token string, objectName string) error {
	srv, err := s.getClient(ctx, token)
	if err != nil {
		return err
	}

	folderId, err := s.EnsureVaultFolder(ctx, token)
	if err != nil {
		return err
	}

	q := fmt.Sprintf("name='%s' and '%s' in parents and trashed=false", objectName, folderId)
	r, err := srv.Files.List().Q(q).Spaces("drive").Do()
	if err != nil {
		return err
	}

	if len(r.Files) == 0 {
		return fmt.Errorf("object not found")
	}

	return srv.Files.Delete(r.Files[0].Id).Do()
}

func (s *GDriveStorage) GetBucketStats(ctx context.Context, token string) (int64, int64, error) {
	srv, err := s.getClient(ctx, token)
	if err != nil {
		return 0, 0, err
	}

	folderId, err := s.EnsureVaultFolder(ctx, token)
	if err != nil {
		return 0, 0, err
	}

	q := fmt.Sprintf("'%s' in parents and trashed=false", folderId)
	r, err := srv.Files.List().Q(q).Fields("files(id, size)").Do()
	if err != nil {
		return 0, 0, err
	}

	var totalSize int64
	for _, f := range r.Files {
		totalSize += f.Size
	}

	return int64(len(r.Files)), totalSize, nil
}
