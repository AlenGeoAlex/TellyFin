export interface IHost {

    download(url: string, path: string) : Promise<{
        status: boolean
        error?: string
    }>;

}